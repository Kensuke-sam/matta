import { expect, test } from "@playwright/test";
import { E2E_PIN, expectNoHorizontalScroll, loginWithPin } from "./helpers";

test("初期表示はPINゲートで、横スクロールが発生しない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "デモ用PINの入力" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "MATTA" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("PIN付き共有リンクで開くと、PIN入力なしで相談フォームへ直行する", async ({ page }) => {
  await page.goto(`/#pin=${E2E_PIN}`);
  await expect(
    page.getByRole("heading", { name: "いま受けている連絡について教えてください" }),
  ).toBeVisible();
  // PINはURLフラグメントから即座に除去される
  expect(new URL(page.url()).hash).toBe("");
});

test("誤ったPINの共有リンクは通常のPIN入力へフォールバックする", async ({ page }) => {
  await page.goto("/#pin=wrong-pin-000");
  await expect(page.getByRole("heading", { name: "デモ用PINの入力" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
});

test("PINゲート表示中にPIN付きリンクへ遷移しても相談フォームへ直行する", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "デモ用PINの入力" })).toBeVisible();
  // ページを開いたままハッシュだけ変わる遷移（同一タブでの共有リンク再訪）を再現する
  await page.evaluate((pin) => {
    window.location.hash = `pin=${pin}`;
  }, E2E_PIN);
  await expect(
    page.getByRole("heading", { name: "いま受けている連絡について教えてください" }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
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

test("共有リンク認証が通信障害で失敗するとPIN画面に案内が出て、手動ログイン成功で消える", async ({
  page,
}) => {
  // 最初のPOST（共有リンクの自動ログイン）だけを通信障害にする
  let aborted = false;
  await page.route("**/api/session", (route) => {
    if (route.request().method() === "POST" && !aborted) {
      aborted = true;
      return route.abort();
    }
    return route.fallback();
  });
  await page.goto(`/#pin=${E2E_PIN}`);

  await expect(page.getByRole("heading", { name: "デモ用PINの入力" })).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "共有リンクでのログインに失敗しました" }),
  ).toBeVisible();

  // 手動ログインが成功したら案内は消える
  await page.getByLabel("PIN").fill(E2E_PIN);
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(
    page.getByRole("heading", { name: "いま受けている連絡について教えてください" }),
  ).toBeVisible();
  await expect(
    page.getByText("共有リンクでのログインに失敗しました", { exact: false }),
  ).toBeHidden();
  await page.unroute("**/api/session");
});

test("ログアウトに失敗したときはPINゲートへ遷移せずエラーを表示する", async ({ page }) => {
  await loginWithPin(page);

  await page.route("**/api/session", (route) => {
    if (route.request().method() === "DELETE") return route.abort();
    return route.fallback();
  });
  await page.getByRole("button", { name: "ログアウト" }).click();

  await expect(
    page.getByRole("alert").filter({ hasText: "ログアウトに失敗しました" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "いま受けている連絡について教えてください" }),
  ).toBeVisible();
  await page.unroute("**/api/session");
});
