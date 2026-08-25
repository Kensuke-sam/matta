import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  createSessionToken,
  isAuthenticated,
  pinConfigured,
  readSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  verifyPin,
  verifySessionToken,
} from "@/lib/session";

const TEST_PIN = "test-pin-1234";

describe("pinConfigured / verifyPin", () => {
  const original = process.env.MATTA_DEMO_PIN;
  afterEach(() => {
    if (original === undefined) delete process.env.MATTA_DEMO_PIN;
    else process.env.MATTA_DEMO_PIN = original;
  });

  it("PIN未設定なら未構成扱いになる", () => {
    delete process.env.MATTA_DEMO_PIN;
    expect(pinConfigured()).toBe(false);
    expect(verifyPin("anything")).toBe(false);
  });

  it("8文字未満のPINは未構成扱いになる", () => {
    process.env.MATTA_DEMO_PIN = "short7c";
    expect(pinConfigured()).toBe(false);
    expect(verifyPin("short7c")).toBe(false);
  });

  it("8文字以上のPINで一致・不一致を判定できる", () => {
    process.env.MATTA_DEMO_PIN = TEST_PIN;
    expect(pinConfigured()).toBe(true);
    expect(verifyPin(TEST_PIN)).toBe(true);
    expect(verifyPin("wrong-pin-999")).toBe(false);
    expect(verifyPin("")).toBe(false);
  });
});

describe("セッショントークン", () => {
  beforeEach(() => {
    process.env.MATTA_DEMO_PIN = TEST_PIN;
  });
  afterEach(() => {
    delete process.env.MATTA_DEMO_PIN;
  });

  it("発行したトークンを検証できる", () => {
    const token = createSessionToken();
    expect(verifySessionToken(token)).toBe(true);
  });

  it("期限切れトークンを拒否する", () => {
    const past = Date.now() - SESSION_TTL_MS - 1000;
    const token = createSessionToken(past);
    expect(verifySessionToken(token)).toBe(false);
  });

  it("改ざんされたトークンを拒否する", () => {
    const token = createSessionToken();
    const [exp, mac] = token.split(".");
    const flipped = mac[0] === "a" ? "b" : "a";
    expect(verifySessionToken(`${exp}.${flipped}${mac.slice(1)}`)).toBe(false);
    expect(verifySessionToken(`${Number(exp) + 9999999}.${mac}`)).toBe(false);
  });

  it("形式不正なトークンを拒否する", () => {
    expect(verifySessionToken(null)).toBe(false);
    expect(verifySessionToken("")).toBe(false);
    expect(verifySessionToken("garbage")).toBe(false);
    expect(verifySessionToken("123")).toBe(false);
    expect(verifySessionToken("abc.def")).toBe(false);
  });

  it("PINが未設定になると既存トークンも無効になる", () => {
    const token = createSessionToken();
    delete process.env.MATTA_DEMO_PIN;
    expect(verifySessionToken(token)).toBe(false);
  });

  it("PINを変更すると既存トークンが無効になる", () => {
    const token = createSessionToken();
    process.env.MATTA_DEMO_PIN = "another-pin-5678";
    expect(verifySessionToken(token)).toBe(false);
  });
});

describe("Cookie入出力", () => {
  beforeEach(() => {
    process.env.MATTA_DEMO_PIN = TEST_PIN;
  });
  afterEach(() => {
    delete process.env.MATTA_DEMO_PIN;
  });

  it("発行CookieにHttpOnly等の属性が付く", () => {
    const cookie = buildSessionCookie("123.abc");
    expect(cookie).toContain(`${SESSION_COOKIE}=123.abc`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });

  it("クリアCookieはMax-Age=0になる", () => {
    expect(buildClearSessionCookie()).toContain("Max-Age=0");
  });

  it("複数Cookieの中からセッショントークンを読み取れる", () => {
    const token = createSessionToken();
    const req = new Request("http://localhost/api/analyze", {
      headers: { cookie: `other=1; ${SESSION_COOKIE}=${token}; theme=light` },
    });
    expect(readSessionToken(req)).toBe(token);
    expect(isAuthenticated(req)).toBe(true);
  });

  it("Cookieが無ければ未認証になる", () => {
    const req = new Request("http://localhost/api/analyze");
    expect(readSessionToken(req)).toBeNull();
    expect(isAuthenticated(req)).toBe(false);
  });
});
