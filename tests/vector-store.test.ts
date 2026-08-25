import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchIndexInfo,
  queryVectors,
  upsertVectors,
  upstashScoreToCosine,
  vectorStoreConfigured,
  VectorStoreError,
  vectorStoreWritable,
} from "@/lib/vector-store";

const BASE_URL = "https://mock-vector.example";

type FetchArgs = { url: string; init: RequestInit };

function stubFetch(response: () => Response | Promise<Response>): FetchArgs[] {
  const calls: FetchArgs[] = [];
  vi.stubGlobal("fetch", (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(response());
  });
  return calls;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

beforeEach(() => {
  process.env.UPSTASH_VECTOR_REST_URL = BASE_URL;
  process.env.UPSTASH_VECTOR_REST_TOKEN = "test-full-token";
  delete process.env.UPSTASH_VECTOR_REST_READONLY_TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.UPSTASH_VECTOR_REST_URL;
  delete process.env.UPSTASH_VECTOR_REST_TOKEN;
  delete process.env.UPSTASH_VECTOR_REST_READONLY_TOKEN;
});

describe("upstashScoreToCosine", () => {
  it("正規化スコア(1+cos)/2を生のコサイン類似度へ戻す", () => {
    expect(upstashScoreToCosine(1)).toBe(1);
    expect(upstashScoreToCosine(0.5)).toBeCloseTo(0, 10);
    expect(upstashScoreToCosine(0)).toBe(-1);
    expect(upstashScoreToCosine(0.65)).toBeCloseTo(0.3, 10);
  });

  it("範囲外の値は-1〜1へクランプする", () => {
    expect(upstashScoreToCosine(1.2)).toBe(1);
    expect(upstashScoreToCosine(-0.2)).toBe(-1);
  });
});

describe("設定判定", () => {
  it("URLとトークンがそろって初めて設定済みになる", () => {
    expect(vectorStoreConfigured()).toBe(true);
    expect(vectorStoreWritable()).toBe(true);
    delete process.env.UPSTASH_VECTOR_REST_TOKEN;
    expect(vectorStoreConfigured()).toBe(false);
    delete process.env.UPSTASH_VECTOR_REST_URL;
    process.env.UPSTASH_VECTOR_REST_TOKEN = "t";
    expect(vectorStoreConfigured()).toBe(false);
  });

  it("READONLYトークンだけでは読み取り可・書き込み不可になる", () => {
    delete process.env.UPSTASH_VECTOR_REST_TOKEN;
    process.env.UPSTASH_VECTOR_REST_READONLY_TOKEN = "test-readonly-token";
    expect(vectorStoreConfigured()).toBe(true);
    expect(vectorStoreWritable()).toBe(false);
  });
});

describe("queryVectors", () => {
  it("namespace付きURLへPOSTし、スコアを生のコサイン類似度へ変換して返す", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        result: [
          {
            id: "police-1",
            score: 0.65,
            metadata: { chunk_id: "police-1", domain: "police", corpus_version: "v1" },
          },
          { id: "police-2", score: 1 },
        ],
      }),
    );
    const matches = await queryVectors("2026-08-25.1", [1, 0, 0], 3);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE_URL}/query/2026-08-25.1`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      vector: [1, 0, 0],
      topK: 3,
      includeMetadata: true,
    });
    expect(matches).toHaveLength(2);
    expect(matches[0].id).toBe("police-1");
    expect(matches[0].similarity).toBeCloseTo(0.3, 10);
    expect(matches[0].metadata).toEqual({
      chunk_id: "police-1",
      domain: "police",
      corpus_version: "v1",
    });
    expect(matches[1].similarity).toBe(1);
    expect(matches[1].metadata).toBeNull();
  });

  it("READONLYトークンがあれば読み取りに優先して使う", async () => {
    process.env.UPSTASH_VECTOR_REST_READONLY_TOKEN = "test-readonly-token";
    const calls = stubFetch(() => jsonResponse({ result: [] }));
    await queryVectors("ns", [1], 3);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-readonly-token");
  });

  it("未設定ならfetchせずにVectorStoreErrorを投げる", async () => {
    delete process.env.UPSTASH_VECTOR_REST_URL;
    const calls = stubFetch(() => jsonResponse({ result: [] }));
    await expect(queryVectors("ns", [1], 3)).rejects.toBeInstanceOf(VectorStoreError);
    expect(calls).toHaveLength(0);
  });

  it("非2xx応答はVectorStoreErrorになる", async () => {
    stubFetch(() => jsonResponse({ error: "x" }, 500));
    await expect(queryVectors("ns", [1], 3)).rejects.toBeInstanceOf(VectorStoreError);
  });

  it("接続失敗・タイムアウトはVectorStoreErrorになる", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("boom")));
    await expect(queryVectors("ns", [1], 3)).rejects.toBeInstanceOf(VectorStoreError);
    const timeoutError = new Error("t");
    timeoutError.name = "TimeoutError";
    vi.stubGlobal("fetch", () => Promise.reject(timeoutError));
    await expect(queryVectors("ns", [1], 3)).rejects.toMatchObject({
      message: "vector store request timed out",
    });
  });

  it("応答形状の異常（非配列・不正スコア・不正ID）はVectorStoreErrorになる", async () => {
    stubFetch(() => jsonResponse({ result: "not-an-array" }));
    await expect(queryVectors("ns", [1], 3)).rejects.toBeInstanceOf(VectorStoreError);
    stubFetch(() => jsonResponse({ result: [{ id: "a", score: 1.5 }] }));
    await expect(queryVectors("ns", [1], 3)).rejects.toBeInstanceOf(VectorStoreError);
    stubFetch(() => jsonResponse({ result: [{ id: "", score: 0.5 }] }));
    await expect(queryVectors("ns", [1], 3)).rejects.toBeInstanceOf(VectorStoreError);
  });
});

describe("upsertVectors", () => {
  it("namespace付きURLへ登録し、Success以外はエラーにする", async () => {
    const calls = stubFetch(() => jsonResponse({ result: "Success" }));
    await upsertVectors("ns-1", [
      { id: "police-1", vector: [1, 0], metadata: { chunk_id: "police-1" } },
    ]);
    expect(calls[0].url).toBe(`${BASE_URL}/upsert/ns-1`);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-full-token");

    stubFetch(() => jsonResponse({ result: "Nope" }));
    await expect(upsertVectors("ns-1", [])).rejects.toBeInstanceOf(VectorStoreError);
  });
});

describe("fetchIndexInfo", () => {
  it("GET /infoの応答からnamespaceごとの件数を取り出す", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        result: {
          vectorCount: 12,
          pendingVectorCount: 0,
          dimension: 1536,
          similarityFunction: "COSINE",
          namespaces: { "2026-08-25.1": { vectorCount: 12, pendingVectorCount: 0 } },
        },
      }),
    );
    const info = await fetchIndexInfo();
    expect(calls[0].url).toBe(`${BASE_URL}/info`);
    expect(calls[0].init.method).toBe("GET");
    expect(info.dimension).toBe(1536);
    expect(info.similarityFunction).toBe("COSINE");
    expect(info.namespaces["2026-08-25.1"]).toEqual({ vectorCount: 12, pendingVectorCount: 0 });
  });

  it("欠落フィールドはnull・空で返す", async () => {
    stubFetch(() => jsonResponse({ result: {} }));
    const info = await fetchIndexInfo();
    expect(info.dimension).toBeNull();
    expect(info.similarityFunction).toBeNull();
    expect(info.namespaces).toEqual({});
  });
});
