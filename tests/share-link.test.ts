import { describe, expect, it } from "vitest";
import { parseSharedPin } from "@/lib/share-link";

describe("parseSharedPin", () => {
  it("#pin=形式からPINを取り出す", () => {
    expect(parseSharedPin("#pin=matta-e2e-pin")).toBe("matta-e2e-pin");
    expect(parseSharedPin("pin=abc12345")).toBe("abc12345");
  });

  it("「+」を空白へ変換しない（URLSearchParamsのフォーム解釈をしない）", () => {
    expect(parseSharedPin("#pin=abc+def123")).toBe("abc+def123");
  });

  it("パーセントエンコードを復元する（&はリンク作成側が%26にする契約）", () => {
    expect(parseSharedPin("#pin=abc%26def123")).toBe("abc&def123");
    expect(parseSharedPin("#pin=a%2Bb%25c123")).toBe("a+b%c123");
  });

  it("他のパラメータと併記されていてもpinだけを取り出す", () => {
    expect(parseSharedPin("#lang=ja&pin=abc12345")).toBe("abc12345");
    expect(parseSharedPin("#pin=abc12345&lang=ja")).toBe("abc12345");
  });

  it("pinが無ければnullを返す", () => {
    expect(parseSharedPin("")).toBeNull();
    expect(parseSharedPin("#")).toBeNull();
    expect(parseSharedPin("#section-1")).toBeNull();
    expect(parseSharedPin("#pinned=1")).toBeNull();
  });

  it("不正な%表記はそのまま返し、サーバー側検証に委ねる", () => {
    expect(parseSharedPin("#pin=abc%zzdef")).toBe("abc%zzdef");
  });
});
