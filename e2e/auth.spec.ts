import { expect, test } from "@playwright/test";
import { E2E_PIN, expectNoHorizontalScroll, loginWithPin } from "./helpers";

test("初期表示はPINゲートで、横スクロールが発生しない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "デモ用PINの入力" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "MATTA" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("誤ったPINはエラーになり、正しいPINで相談フォームが表示される", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("PIN").fill("wrong-pin-000");
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "PIN" })).toContainText(
    "PINが一致しません",
  );

  await page.getByLabel("PIN").fill(E2E_PIN);
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(
    page.getByRole("heading", { name: "いま受けている連絡について教えてください" }),
  ).toBeVisible();
});

test("ログイン状態はリロード後も維持され、ログアウトでPINゲートへ戻る", async ({ page }) => {
  await loginWithPin(page);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "いま受けている連絡について教えてください" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page.getByRole("heading", { name: "デモ用PINの入力" })).toBeVisible();
});
