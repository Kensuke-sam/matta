import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHUNKS, CORPUS_VERSION } from "@/lib/corpus";
import type { EmbedFn } from "@/lib/openai";
import type { VectorQueryMatch, VectorStoreHealth } from "@/lib/vector-store";

const vectorMock = vi.hoisted(() => ({
  configured: false,
  queryCalls: [] as { namespace: string; topK: number }[],
  probeCalls: 0,
  query: (async () => []) as (
    namespace: string,
    vector: number[],
    topK: number,
  ) => Promise<{ id: string; similarity: number; metadata: Record<string, unknown> | null }[]>,
  probe: (async () => ({ reachable: false, namespaceVectorCount: null })) as () => Promise<{
    reachable: boolean;
    namespaceVectorCount: number | null;
  }>,
}));

vi.mock("@/lib/vector-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vector-store")>();
  return {
    ...actual,
    vectorStoreConfigured: () => vectorMock.configured,
    queryVectors: (namespace: string, vector: number[], topK: number) => {
      vectorMock.queryCalls.push({ namespace, topK });
      return vectorMock.query(namespace, vector, topK);
    },
    probeVectorStoreHealth: (): Promise<VectorStoreHealth> => {
      vectorMock.probeCalls += 1;
      return vectorMock.probe();
    },
  };
});

import * as healthRoute from "@/app/api/health/route";
import { _resetCorpusCache, configuredSearchBackend, retrieve } from "@/lib/retrieval";
import { VectorStoreError } from "@/lib/vector-store";

// チャンクiに [1,0,0,0.1*i] を割り当てるfake。クエリ[1,0,0,0]との類似度はi昇順で下がる
function rankedEmbed(): { embed: EmbedFn; calls: string[][] } {
  const calls: string[][] = [];
  const embed: EmbedFn = async (texts) => {
    calls.push(texts);
    if (texts.length === CHUNKS.length) {
      return texts.map((_, i) => [1, 0, 0, 0.1 * i]);
    }
    return texts.map(() => [1, 0, 0, 0]);
  };
  return { embed, calls };
}

// seedが書き込む4キーのメタデータを持つ正常なmatch（検索側の必須検証を通る形）
function upstashMatch(id: string, similarity: number): VectorQueryMatch {
  return {
    id,
    similarity,
    metadata: {
      chunk_id: id,
      domain: "police",
      corpus_version: CORPUS_VERSION,
      embedding_model: "text-embedding-3-small",
    },
  };
}

beforeEach(() => {
  _resetCorpusCache();
  vectorMock.configured = false;
  vectorMock.queryCalls = [];
  vectorMock.probeCalls = 0;
  vectorMock.query = async () => [];
  vectorMock.probe = async () => ({ reachable: false, namespaceVectorCount: null });
  delete process.env.MATTA_SEARCH_BACKEND;
  delete process.env.MATTA_EMBEDDING_MODEL;
});

afterEach(() => {
  delete process.env.MATTA_SEARCH_BACKEND;
});

describe("configuredSearchBackend", () => {
  it("未設定時はUpstash設定の有無で自動判定する", () => {
    expect(configuredSearchBackend()).toBe("local");
    vectorMock.configured = true;
    expect(configuredSearchBackend()).toBe("upstash");
  });

  it("MATTA_SEARCH_BACKENDの明示指定が優先される", () => {
    vectorMock.configured = true;
    process.env.MATTA_SEARCH_BACKEND = "local";
    expect(configuredSearchBackend()).toBe("local");
    vectorMock.configured = false;
    process.env.MATTA_SEARCH_BACKEND = "upstash";
    expect(configuredSearchBackend()).toBe("upstash");
  });
});

describe("retrieve", () => {
  it("localバックエンドではVector DBを呼ばずローカル検索する", async () => {
    const { embed } = rankedEmbed();
    const outcome = await retrieve("query", embed);
    expect(outcome.backend).toBe("local");
    expect(outcome.fallback).toBe(false);
    expect(outcome.results).toHaveLength(3);
    expect(vectorMock.queryCalls).toHaveLength(0);
  });

  it("upstashバックエンドではcorpus_versionのnamespaceをTop 3検索し、結果をコーパスへ解決する", async () => {
    vectorMock.configured = true;
    vectorMock.query = async () => [
      upstashMatch("police-2", 0.92),
      upstashMatch("police-1", 0.88),
      upstashMatch("delivery-1", 0.41),
    ];
    const { embed, calls } = rankedEmbed();
    const outcome = await retrieve("query", embed);
    expect(outcome.backend).toBe("upstash");
    expect(outcome.fallback).toBe(false);
    expect(outcome.results.map((r) => r.chunk.id)).toEqual(["police-2", "police-1", "delivery-1"]);
    expect(outcome.results[0].similarity).toBe(0.92);
    expect(outcome.results[0].chunk.title).toBe(
      CHUNKS.find((c) => c.id === "police-2")?.title,
    );
    expect(vectorMock.queryCalls).toEqual([{ namespace: CORPUS_VERSION, topK: 3 }]);
    // クエリのEmbeddingだけを行い、コーパス12件のEmbeddingはしない
    expect(calls).toEqual([["query"]]);
  });

  it("類似度が低くてもフォールバックしない（根拠不足は呼び出し側で停止する）", async () => {
    vectorMock.configured = true;
    vectorMock.query = async () => [
      upstashMatch("police-1", 0.05),
      upstashMatch("police-2", 0.04),
      upstashMatch("police-3", 0.03),
    ];
    const { embed } = rankedEmbed();
    const outcome = await retrieve("query", embed);
    expect(outcome.backend).toBe("upstash");
    expect(outcome.fallback).toBe(false);
    expect(outcome.results[0].similarity).toBe(0.05);
  });

  it("外部呼び出し直前フックが例外を投げたらそのまま伝播する（フォールバックしない）", async () => {
    vectorMock.configured = true;
    const { embed } = rankedEmbed();
    const budgetError = new Error("time budget exceeded");
    await expect(
      retrieve("query", embed, 3, () => {
        throw budgetError;
      }),
    ).rejects.toBe(budgetError);
    expect(vectorMock.queryCalls).toHaveLength(0);
  });

  // ストア異常の各系: ローカル検索へフォールバックし、フォールバックであることを記録する
  async function expectFallbackToLocal(behavior: typeof vectorMock.query): Promise<void> {
    vectorMock.configured = true;
    vectorMock.query = behavior;
    const { embed } = rankedEmbed();
    const outcome = await retrieve("query", embed);
    expect(outcome.backend).toBe("local");
    expect(outcome.fallback).toBe(true);
    expect(outcome.results).toHaveLength(3);
    expect(outcome.results.map((r) => r.chunk.id)).toEqual([
      CHUNKS[0].id,
      CHUNKS[1].id,
      CHUNKS[2].id,
    ]);
  }

  it("接続エラーはローカル検索へフォールバックする", () =>
    expectFallbackToLocal(async () => {
      throw new VectorStoreError("down");
    }));

  it("0件応答はストア異常としてフォールバックする", () => expectFallbackToLocal(async () => []));

  it("件数不足（Top 3に満たない）はフォールバックする", () =>
    expectFallbackToLocal(async () => [upstashMatch("police-1", 0.9)]));

  it("重複IDはフォールバックする", () =>
    expectFallbackToLocal(async () => [
      upstashMatch("police-1", 0.9),
      upstashMatch("police-1", 0.8),
      upstashMatch("police-2", 0.7),
    ]));

  it("未知のチャンクIDはフォールバックする", () =>
    expectFallbackToLocal(async () => [
      upstashMatch("unknown-id", 0.9),
      upstashMatch("police-1", 0.8),
      upstashMatch("police-2", 0.7),
    ]));

  it("メタデータ欠落はフォールバックする", () =>
    expectFallbackToLocal(async () => [
      { id: "police-1", similarity: 0.9, metadata: null },
      upstashMatch("police-2", 0.8),
      upstashMatch("police-3", 0.7),
    ]));

  it("corpus_version不一致はフォールバックする", () =>
    expectFallbackToLocal(async () => {
      const stale = upstashMatch("police-1", 0.9);
      stale.metadata = { ...(stale.metadata ?? {}), corpus_version: "old-version" };
      return [stale, upstashMatch("police-2", 0.8), upstashMatch("police-3", 0.7)];
    }));

  it("Embeddingモデル不一致（同次元の別モデルの古いベクトル）はフォールバックする", () =>
    expectFallbackToLocal(async () => {
      const staleModel = upstashMatch("police-1", 0.9);
      staleModel.metadata = { ...(staleModel.metadata ?? {}), embedding_model: "other-model" };
      return [staleModel, upstashMatch("police-2", 0.8), upstashMatch("police-3", 0.7)];
    }));

  it("VectorStoreError以外の例外はフォールバックせず伝播する", async () => {
    vectorMock.configured = true;
    vectorMock.query = async () => {
      throw new TypeError("bug");
    };
    const { embed } = rankedEmbed();
    await expect(retrieve("query", embed)).rejects.toBeInstanceOf(TypeError);
  });
});

describe("/api/health のVector DB状態", () => {
  beforeEach(() => {
    process.env.MATTA_DEMO_PIN = "test-pin-1234";
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  });

  it("upstashバックエンド時は実接続とseed件数を報告する", async () => {
    vectorMock.configured = true;
    vectorMock.probe = async () => ({ reachable: true, namespaceVectorCount: 12 });
    const body = await (await healthRoute.GET()).json();
    expect(body.search_backend).toBe("upstash");
    expect(body.vector_store).toEqual({
      configured: true,
      reachable: true,
      namespace_vector_count: 12,
    });
  });

  it("接続失敗時はreachable:falseを報告する", async () => {
    vectorMock.configured = true;
    vectorMock.probe = async () => ({ reachable: false, namespaceVectorCount: null });
    const body = await (await healthRoute.GET()).json();
    expect(body.vector_store).toEqual({
      configured: true,
      reachable: false,
      namespace_vector_count: null,
    });
  });

  it("未seedのnamespaceは0件として報告する", async () => {
    vectorMock.configured = true;
    vectorMock.probe = async () => ({ reachable: true, namespaceVectorCount: 0 });
    const body = await (await healthRoute.GET()).json();
    expect(body.vector_store.namespace_vector_count).toBe(0);
  });

  it("local明示切替時は設定があっても実接続確認しない", async () => {
    vectorMock.configured = true;
    process.env.MATTA_SEARCH_BACKEND = "local";
    const body = await (await healthRoute.GET()).json();
    expect(body.search_backend).toBe("local");
    expect(body.vector_store).toEqual({
      configured: true,
      reachable: null,
      namespace_vector_count: null,
    });
    expect(vectorMock.probeCalls).toBe(0);
  });
});
