import { expect, test } from "@playwright/test";
import { CHUNKS, CORPUS_VERSION } from "../lib/corpus";
import { loginWithPin } from "./helpers";

// 既定のbaseURL(3971)のアプリはUpstash Vectorモック(8966)へ接続している

test("healthがUpstash接続とseed済み全件を報告する", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.search_backend).toBe("upstash");
  expect(body.vector_store).toEqual({
    configured: true,
    reachable: true,
    namespace_vector_count: CHUNKS.length,
  });
});

test("警察デモがUpstash Vector検索で完走し、インスペクタへバックエンドが表示される", async ({
  page,
}) => {
  await loginWithPin(page);
  await page.getByRole("button", { name: "警察を名乗る電話" }).click();
  await page.getByRole("button", { name: "この内容で確認する" }).click();

  await expect(page.getByRole("heading", { name: "危険サイン" })).toBeVisible();
  const inspector = page.getByTestId("inspector");
  await inspector.locator("summary").click();
  await expect(inspector.getByTestId("search-backend")).toHaveText("Upstash Vector");
  await expect(inspector.getByTestId("search-fallback")).toBeHidden();
  await expect(inspector.getByText(CORPUS_VERSION)).toBeVisible();
});

test("曖昧な不審連絡の相談はUpstash検索でも類似度不足で停止し、フォールバックしない", async ({ page }) => {
  await loginWithPin(page);
  await page
    .getByLabel("相談内容")
    .fill("知らない会社から保険の見直しを勧める電話がありました。怪しいか分からず、どうすればいいですか。");
  await page.getByRole("button", { name: "この内容で確認する" }).click();

  await expect(
    page.getByRole("heading", { name: "十分な根拠が見つかりませんでした" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "危険サイン" })).toBeHidden();

  // 停止理由のインスペクタ: Upstashで検索した上で閾値未満だったことが分かる
  const inspector = page.getByTestId("insufficient-inspector");
  await inspector.locator("summary").click();
  await expect(inspector.getByTestId("search-backend")).toHaveText("Upstash Vector");
  await expect(inspector.getByTestId("search-fallback")).toBeHidden();
  await expect(inspector.getByTestId("top-similarity")).toHaveText(/^\d\.\d{3}$/);
  // 表示上も「最上位類似度 < 停止閾値(0.3)」の関係が成り立っている
  const topSimilarity = Number(await inspector.getByTestId("top-similarity").textContent());
  expect(topSimilarity).toBeLessThan(0.3);
});
