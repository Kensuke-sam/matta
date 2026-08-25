import { expect, test } from "@playwright/test";
import { DEMOS } from "../lib/demos";
import { expectNoHorizontalScroll, loginWithPin } from "./helpers";

const RESULT_HEADINGS = [
  "類似する公的事例",
  "危険サイン",
  "本物なら通常こうする",
  "今、してはいけないこと",
  "安全な確認方法",
];

test("3種類のデモ入力が相談文へ反映される", async ({ page }) => {
  await loginWithPin(page);
  for (const demo of DEMOS) {
    await page.getByRole("button", { name: demo.label }).click();
    await expect(page.getByLabel("相談内容")).toHaveValue(demo.text);
  }
});

test("警察デモ: 5点出力と中断表示が出て、類似度は審査用の折りたたみ欄だけに表示される", async ({
  page,
}) => {
  await loginWithPin(page);
  await page.getByRole("button", { name: "警察を名乗る電話" }).click();
  await page.getByRole("button", { name: "この内容で確認する" }).click();

  await expect(
    page.getByText("まずは、相手とのやり取りをいったん止めてください。"),
  ).toBeVisible();
  for (const heading of RESULT_HEADINGS) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(page.getByText("#9110").first()).toBeVisible();

  // 類似度は折りたたみを開くまで見えない
  const inspector = page.getByTestId("inspector");
  await expect(inspector).toBeVisible();
  expect(await inspector.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
  await expect(page.getByTestId("similarity-0")).toBeHidden();

  await inspector.locator("summary").click();
  await expect(page.getByTestId("similarity-0")).toBeVisible();
  await expect(page.getByTestId("similarity-0")).toHaveText(/^\d\.\d{3}$/);

  await expectNoHorizontalScroll(page);
});

test("配送フィッシングデモと副業デモも結果画面まで完走する", async ({ page }) => {
  await loginWithPin(page);

  for (const demoId of ["delivery", "sidejob"] as const) {
    const demo = DEMOS.find((d) => d.id === demoId)!;
    await page.getByRole("button", { name: demo.label }).click();
    await page.getByRole("button", { name: "この内容で確認する" }).click();
    await expect(page.getByRole("heading", { name: "危険サイン" })).toBeVisible();
    await page.getByRole("button", { name: "新しい相談をはじめる" }).click();
    await expect(page.getByLabel("相談内容")).toHaveValue("");
  }
});

test("圏外入力では判定せず、根拠不足の案内で停止する", async ({ page }) => {
  await loginWithPin(page);
  await page.getByLabel("相談内容").fill("今日の夕飯の献立を考えてください。");
  await page.getByRole("button", { name: "この内容で確認する" }).click();

  await expect(
    page.getByRole("heading", { name: "十分な根拠が見つかりませんでした" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "危険サイン" })).toBeHidden();
  await expect(page.getByText("#9110").first()).toBeVisible();
});

test("被害後の入力は検索せず緊急対応カードへ分岐する", async ({ page }) => {
  await loginWithPin(page);
  await page
    .getByLabel("相談内容")
    .fill("警察を名乗る人に言われるまま、さっきATMでお金を振り込んでしまいました。");
  await page.getByRole("button", { name: "この内容で確認する" }).click();

  await expect(
    page.getByRole("heading", { name: "すでに渡してしまった場合の緊急対応" }),
  ).toBeVisible();
  await expect(page.getByText("110", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("188", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "危険サイン" })).toBeHidden();
  await expect(page.getByTestId("inspector")).toBeHidden();

  await expectNoHorizontalScroll(page);
});
