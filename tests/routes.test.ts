import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHUNKS } from "@/lib/corpus";

const mockState = vi.hoisted(() => ({
  openaiConfigured: true,
  triage: JSON.stringify({ category: "consultation", missing: [] }),
  generation: JSON.stringify({
    related: true,
    similar_cases: ["類似1"],
    danger_signs: ["サイン1"],
    normal_response: ["通常1"],
    do_not: ["禁止1"],
    safe_verification: ["#9110に相談する"],
  }),
  chatError: null as Error | null,
}));

vi.mock("@/lib/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/openai")>();
  const embedTexts: typeof actual.embedTexts = async (texts) => {
    const isCorpus = texts.length === 12;
    return texts.map((t, i) => {
      const noise = isCorpus ? 0.005 * (i + 1) : 0;
      if (/(警察|逮捕|取り調べ)/.test(t)) return [1, 0, 0, noise];
      return [0, 0, 0, 1];
    });
  };
  const chatJson: typeof actual.chatJson = async ({ system }) => {
    if (mockState.chatError) throw mockState.chatError;
    return system.includes("トリアージ") ? mockState.triage : mockState.generation;
  };
  return {
    ...actual,
    openaiConfigured: () => mockState.openaiConfigured,
    embedTexts,
    chatJson,
  };
});

import * as analyzeRoute from "@/app/api/analyze/route";
import * as healthRoute from "@/app/api/health/route";
import * as sessionRoute from "@/app/api/session/route";
import { UpstreamError } from "@/lib/openai";
import { _resetRateLimit, SESSION_RATE } from "@/lib/ratelimit";
import { _resetCorpusCache } from "@/lib/retrieval";
import { SESSION_COOKIE } from "@/lib/session";

const TEST_PIN = "test-pin-1234";
const BASE = "http://localhost";

function jsonRequest(path: string, method: string, body?: unknown, cookie?: string) {
  return new Request(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function login(): Promise<string> {
  const res = await sessionRoute.POST(
    jsonRequest("/api/session", "POST", { pin: TEST_PIN }),
  );
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const token = setCookie.split(";")[0];
  expect(token.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
  return token;
}

beforeEach(() => {
  process.env.MATTA_DEMO_PIN = TEST_PIN;
  mockState.openaiConfigured = true;
  mockState.chatError = null;
  mockState.triage = JSON.stringify({ category: "consultation", missing: [] });
  _resetRateLimit();
  _resetCorpusCache();
});

afterEach(() => {
  delete process.env.MATTA_DEMO_PIN;
});

describe("GET /api/health", () => {
  it("設定状況とコーパス版だけを返す", async () => {
    const res = await healthRoute.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      openai_configured: true,
      pin_configured: true,
      corpus_version: expect.any(String),
      chunk_count: CHUNKS.length,
    });
  });

  it("未設定の場合はフラグがfalseになる", async () => {
    delete process.env.MATTA_DEMO_PIN;
    mockState.openaiConfigured = false;
    const body = await (await healthRoute.GET()).json();
    expect(body.openai_configured).toBe(false);
    expect(body.pin_configured).toBe(false);
  });
});

describe("/api/session", () => {
  it("正しいPINでHttpOnly Cookieを発行する", async () => {
    const res = await sessionRoute.POST(
      jsonRequest("/api/session", "POST", { pin: TEST_PIN }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("誤ったPINは401になる", async () => {
    const res = await sessionRoute.POST(
      jsonRequest("/api/session", "POST", { pin: "wrong-pin-999" }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_pin");
  });

  it("PIN未設定なら503になる", async () => {
    delete process.env.MATTA_DEMO_PIN;
    const res = await sessionRoute.POST(
      jsonRequest("/api/session", "POST", { pin: "whatever-123" }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("pin_not_configured");
  });

  it("形式不正のボディは400になる", async () => {
    const res = await sessionRoute.POST(
      new Request(`${BASE}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
    const res2 = await sessionRoute.POST(jsonRequest("/api/session", "POST", { pin: 5 }));
    expect(res2.status).toBe(400);
  });

  it("GETで認証状態を返す", async () => {
    const anon = await sessionRoute.GET(jsonRequest("/api/session", "GET"));
    expect((await anon.json()).authenticated).toBe(false);
    const cookie = await login();
    const authed = await sessionRoute.GET(
      jsonRequest("/api/session", "GET", undefined, cookie),
    );
    expect((await authed.json()).authenticated).toBe(true);
  });

  it("DELETEでCookieを失効させる", async () => {
    const res = await sessionRoute.DELETE();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("PIN試行がレート制限される", async () => {
    for (let i = 0; i < SESSION_RATE.limit; i++) {
      const res = await sessionRoute.POST(
        jsonRequest("/api/session", "POST", { pin: "wrong-pin-999" }),
      );
      expect(res.status).toBe(401);
    }
    const blocked = await sessionRoute.POST(
      jsonRequest("/api/session", "POST", { pin: TEST_PIN }),
    );
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error.code).toBe("rate_limited");
  });
});

describe("POST /api/analyze", () => {
  it("未認証は401になる", async () => {
    const res = await analyzeRoute.POST(
      jsonRequest("/api/analyze", "POST", { message: "警察を名乗る電話" }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
  });

  it("認証済みで正常フローが完走する", async () => {
    const cookie = await login();
    const res = await analyzeRoute.POST(
      jsonRequest(
        "/api/analyze",
        "POST",
        { message: "警察を名乗る電話で口座を調べると言われました" },
        cookie,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("complete");
    expect(body.result.evidence).toHaveLength(3);
  });

  it("入力検証エラーは400になる", async () => {
    const cookie = await login();
    const empty = await analyzeRoute.POST(
      jsonRequest("/api/analyze", "POST", { message: "   " }, cookie),
    );
    expect(empty.status).toBe(400);
    const tooLong = await analyzeRoute.POST(
      jsonRequest("/api/analyze", "POST", { message: "あ".repeat(2001) }, cookie),
    );
    expect(tooLong.status).toBe(400);
    const tooManyAnswers = await analyzeRoute.POST(
      jsonRequest(
        "/api/analyze",
        "POST",
        {
          message: "怪しい連絡",
          answers: [
            { question: "q1", answer: "a1" },
            { question: "q2", answer: "a2" },
            { question: "q3", answer: "a3" },
          ],
        },
        cookie,
      ),
    );
    expect(tooManyAnswers.status).toBe(400);
    const badShape = await analyzeRoute.POST(
      jsonRequest("/api/analyze", "POST", { message: 123 }, cookie),
    );
    expect(badShape.status).toBe(400);
  });

  it("OPENAI_API_KEY未設定は503になる", async () => {
    const cookie = await login();
    mockState.openaiConfigured = false;
    const res = await analyzeRoute.POST(
      jsonRequest("/api/analyze", "POST", { message: "警察を名乗る電話" }, cookie),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("openai_not_configured");
  });

  it("上流エラーは502へマップされる", async () => {
    const cookie = await login();
    mockState.chatError = new UpstreamError("upstream_error", "boom");
    const res = await analyzeRoute.POST(
      jsonRequest("/api/analyze", "POST", { message: "警察を名乗る電話" }, cookie),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("upstream_error");
  });

  it("タイムアウトは504へマップされる", async () => {
    const cookie = await login();
    mockState.chatError = new UpstreamError("upstream_timeout", "timeout");
    const res = await analyzeRoute.POST(
      jsonRequest("/api/analyze", "POST", { message: "警察を名乗る電話" }, cookie),
    );
    expect(res.status).toBe(504);
  });

  it("既遂入力はincidentカードを返す", async () => {
    const cookie = await login();
    mockState.triage = JSON.stringify({ category: "incident", missing: [] });
    const res = await analyzeRoute.POST(
      jsonRequest(
        "/api/analyze",
        "POST",
        { message: "言われるまま振り込んでしまいました" },
        cookie,
      ),
    );
    const body = await res.json();
    expect(body.status).toBe("incident");
    expect(body.incident.steps.length).toBeGreaterThan(0);
  });
});
