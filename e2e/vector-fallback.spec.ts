import { expect, test } from "@playwright/test";
import { loginWithPin } from "./helpers";

// Upstash接続先を閉じたポートへ向けたインスタンス
// （playwright.config.tsのAPP_VECTOR_DOWN_PORT。既定3972、環境変数で上書き可）へ接続する
const VECTOR_DOWN_PORT = Number(process.env.E2E_APP_VECTOR_DOWN_PORT) || 3972;
test.use({ baseURL: `http://127.0.0.1:${VECTOR_DOWN_PORT}` });

test("healthがVector DBへ接続できないことを報告する", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.search_backend).toBe("upstash");
  expect(body.vector_store.configured).toBe(true);
  expect(body.vector_store.reachable).toBe(false);
  expect(body.vector_store.namespace_vector_count).toBeNull();
});

test("Vector DB障害時はローカル意味検索へフォールバックして完走し、その旨を表示する", async ({
  page,
}) => {
  await loginWithPin(page);
  await page.getByRole("button", { name: "宅配の不在通知SMS" }).click();
  await page.getByRole("button", { name: "この内容で確認する" }).click();

  await expect(page.getByRole("heading", { name: "危険サイン" })).toBeVisible();
  const inspector = page.getByTestId("inspector");
  await inspector.locator("summary").click();
  await expect(inspector.getByTestId("search-backend")).toHaveText("ローカル意味検索");
  await expect(inspector.getByTestId("search-fallback")).toBeVisible();
});
