import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatJson, embedTexts, openaiConfigured } from "@/lib/openai";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
  vi.stubGlobal("fetch", vi.fn(impl));
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test-dummy";
  delete process.env.OPENAI_BASE_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
});

describe("openaiConfigured", () => {
  it("キー未設定ならfalse、設定済みならtrue", () => {
    expect(openaiConfigured()).toBe(true);
    delete process.env.OPENAI_API_KEY;
    expect(openaiConfigured()).toBe(false);
  });
});

describe("HTTP異常系", () => {
  it("キー未設定はfetchせずopenai_not_configuredを投げる", async () => {
    delete process.env.OPENAI_API_KEY;
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(embedTexts(["a"])).rejects.toMatchObject({
      code: "openai_not_configured",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("非200応答はupstream_errorになり、ボディは読まない", async () => {
    stubFetch(async () => new Response("secret error body", { status: 500 }));
    await expect(embedTexts(["a"])).rejects.toMatchObject({ code: "upstream_error" });
  });

  it("ネットワーク失敗はupstream_errorになる", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(embedTexts(["a"])).rejects.toMatchObject({ code: "upstream_error" });
  });

  it("タイムアウトはupstream_timeoutになる", async () => {
    stubFetch(async () => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    });
    await expect(embedTexts(["a"])).rejects.toMatchObject({ code: "upstream_timeout" });
  });

  it("非JSONボディはupstream_errorになる", async () => {
    stubFetch(async () => new Response("not json", { status: 200 }));
    await expect(embedTexts(["a"])).rejects.toMatchObject({ code: "upstream_error" });
  });
});

describe("chatJson", () => {
  it("choicesが空・contentが空文字ならupstream_errorになる", async () => {
    stubFetch(async () => jsonResponse({ choices: [] }));
    await expect(chatJson({ system: "s", user: "u" })).rejects.toMatchObject({
      code: "upstream_error",
    });
    stubFetch(async () =>
      jsonResponse({ choices: [{ message: { role: "assistant", content: "  " } }] }),
    );
    await expect(chatJson({ system: "s", user: "u" })).rejects.toMatchObject({
      code: "upstream_error",
    });
  });

  it("正常応答はcontent文字列を返す", async () => {
    stubFetch(async () =>
      jsonResponse({ choices: [{ message: { role: "assistant", content: '{"a":1}' } }] }),
    );
    await expect(chatJson({ system: "s", user: "u" })).resolves.toBe('{"a":1}');
  });
});

describe("embedTextsの境界検証", () => {
  it("indexが逆順でも元の並びへ復元する", async () => {
    stubFetch(async () =>
      jsonResponse({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      }),
    );
    await expect(embedTexts(["a", "b"])).resolves.toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("件数不一致を拒否する", async () => {
    stubFetch(async () => jsonResponse({ data: [{ index: 0, embedding: [1] }] }));
    await expect(embedTexts(["a", "b"])).rejects.toMatchObject({
      code: "upstream_error",
    });
  });

  it("indexの重複・範囲外・欠落を拒否する", async () => {
    stubFetch(async () =>
      jsonResponse({
        data: [
          { index: 0, embedding: [1] },
          { index: 0, embedding: [2] },
        ],
      }),
    );
    await expect(embedTexts(["a", "b"])).rejects.toMatchObject({
      code: "upstream_error",
    });
    stubFetch(async () =>
      jsonResponse({
        data: [
          { index: 0, embedding: [1] },
          { index: 5, embedding: [2] },
        ],
      }),
    );
    await expect(embedTexts(["a", "b"])).rejects.toMatchObject({
      code: "upstream_error",
    });
    stubFetch(async () =>
      jsonResponse({
        data: [
          { index: 0, embedding: [1] },
          { embedding: [2] },
        ],
      }),
    );
    await expect(embedTexts(["a", "b"])).rejects.toMatchObject({
      code: "upstream_error",
    });
  });

  it("非有限値・空ベクトル・次元不一致を拒否する", async () => {
    stubFetch(async () =>
      jsonResponse({ data: [{ index: 0, embedding: [Number.NaN] }] }),
    );
    await expect(embedTexts(["a"])).rejects.toMatchObject({ code: "upstream_error" });
    stubFetch(async () => jsonResponse({ data: [{ index: 0, embedding: [] }] }));
    await expect(embedTexts(["a"])).rejects.toMatchObject({ code: "upstream_error" });
    stubFetch(async () =>
      jsonResponse({
        data: [
          { index: 0, embedding: [1, 2] },
          { index: 1, embedding: [1] },
        ],
      }),
    );
    await expect(embedTexts(["a", "b"])).rejects.toMatchObject({
      code: "upstream_error",
    });
  });
});
