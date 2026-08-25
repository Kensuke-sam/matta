import { describe, expect, it } from "vitest";
import {
  containsDisallowedContact,
  listsContainDisallowedContact,
  redactContactInfo,
} from "@/lib/sanitize";

describe("containsDisallowedContact", () => {
  it("公式窓口の番号は許可する", () => {
    expect(containsDisallowedContact("警察相談専用電話#9110へかける")).toBe(false);
    expect(containsDisallowedContact("消費者ホットライン188へ相談する")).toBe(false);
    expect(containsDisallowedContact("緊急のときは110番へ電話する")).toBe(false);
  });

  it("許可外の電話番号形式を検出する", () => {
    expect(containsDisallowedContact("0120-123-456へ電話してください")).toBe(true);
    expect(containsDisallowedContact("03-1234-5678までご連絡ください")).toBe(true);
    expect(containsDisallowedContact("09012345678に電話")).toBe(true);
    expect(containsDisallowedContact("#1234へダイヤル")).toBe(true);
  });

  it("全角数字・全角区切りも正規化して検出する", () => {
    expect(containsDisallowedContact("０１２０－１１１－２２２へ")).toBe(true);
    expect(containsDisallowedContact("０３ー１２３４ー５６７８")).toBe(true);
  });

  it("年号・金額を誤検出しない", () => {
    expect(containsDisallowedContact("2026年に公表された事例です")).toBe(false);
    expect(containsDisallowedContact("5000円を請求された事例があります")).toBe(false);
    expect(containsDisallowedContact("5万円の振り込みを求められた")).toBe(false);
  });

  it("配列群のどこかに許可外番号があれば検出する", () => {
    expect(
      listsContainDisallowedContact([
        ["#9110へ相談する"],
        ["188へ相談する", "0120-999-888へ電話する"],
      ]),
    ).toBe(true);
    expect(
      listsContainDisallowedContact([["#9110へ相談する"], ["188へ相談する"]]),
    ).toBe(false);
  });
});

describe("redactContactInfo", () => {
  it("電話番号を置換し、公式窓口の#9110は残す", () => {
    expect(redactContactInfo("0120-123-456へ電話しろと言われた")).toBe(
      "[電話番号]へ電話しろと言われた",
    );
    expect(redactContactInfo("09012345678から着信があった")).toBe("[電話番号]から着信があった");
    expect(redactContactInfo("#9110へ相談するつもりです")).toBe("#9110へ相談するつもりです");
    expect(redactContactInfo("#1234へダイヤルしろと言われた")).toBe(
      "[電話番号]へダイヤルしろと言われた",
    );
  });

  it("全角の電話番号も正規化して置換する", () => {
    expect(redactContactInfo("０１２０－１１１－２２２へかけてしまいそう")).toBe(
      "[電話番号]へかけてしまいそう",
    );
  });

  it("URLを置換し、直後の日本語文は巻き込まない", () => {
    expect(redactContactInfo("https://example.com/track?id=123を開けと言われた")).toBe(
      "[URL]を開けと言われた",
    );
    expect(redactContactInfo("www.example-delivery.jp/aB3 へ誘導された")).toBe(
      "[URL] へ誘導された",
    );
  });

  it("メールアドレスを置換する", () => {
    expect(redactContactInfo("test.user+tag@example.co.jpから届いた")).toBe(
      "[メールアドレス]から届いた",
    );
  });

  it("連絡先を含まない相談文は意味を変えない", () => {
    expect(redactContactInfo("警察を名乗る電話で口座を調べると言われた")).toBe(
      "警察を名乗る電話で口座を調べると言われた",
    );
  });

  it("複数種類が混在してもすべて置換する", () => {
    const text =
      "03-1234-5678から電話があり、https://evil.example/xを開いてscam@example.comへ返信しろと言われた";
    const redacted = redactContactInfo(text);
    expect(redacted).toBe(
      "[電話番号]から電話があり、[URL]を開いて[メールアドレス]へ返信しろと言われた",
    );
  });
});
