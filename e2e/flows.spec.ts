import { expect, test } from "@playwright/test";
import { DEMOS } from "../lib/demos";
import { QUESTION_BANK } from "../lib/questions";
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

test("配送フィッシングデモは配送系の根拠と文言で完走する", async ({ page }) => {
  await loginWithPin(page);
  const demo = DEMOS.find((d) => d.id === "delivery")!;
  await page.getByRole("button", { name: demo.label }).click();
  await page.getByRole("button", { name: "この内容で確認する" }).click();

  await expect(page.getByRole("heading", { name: "危険サイン" })).toBeVisible();
  await expect(
    page.getByText("偽サイトへ誘導する手口が報告されています"),
  ).toBeVisible();

  const inspector = page.getByTestId("inspector");
  await inspector.locator("summary").click();
  await expect(inspector.getByText("スミッシング")).toBeVisible();

  await page.getByRole("button", { name: "新しい相談をはじめる" }).click();
  await expect(page.getByLabel("相談内容")).toHaveValue("");
});

test("副業デモは闇バイト系の根拠と文言で完走する", async ({ page }) => {
  await loginWithPin(page);
  const demo = DEMOS.find((d) => d.id === "sidejob")!;
  await page.getByRole("button", { name: demo.label }).click();
  await page.getByRole("button", { name: "この内容で確認する" }).click();

  await expect(page.getByRole("heading", { name: "危険サイン" })).toBeVisible();
  await expect(
    page.getByText("身分証を送らせる闇バイト募集の手口が公的資料にあります"),
  ).toBeVisible();

  const inspector = page.getByTestId("inspector");
  await inspector.locator("summary").click();
  await expect(
    inspector.getByText("闇バイト（犯罪実行者募集）の募集の特徴"),
  ).toBeVisible();
});

test("情報不足の相談では固定文言の追加質問を経て結果に到達する", async ({ page }) => {
  await loginWithPin(page);
  await page
    .getByLabel("相談内容")
    .fill("変な連絡が来て困っています。どうすればいいですか。");
  await page.getByRole("button", { name: "この内容で確認する" }).click();

  await expect(
    page.getByRole("heading", { name: "もう少しだけ教えてください" }),
  ).toBeVisible();
  await page.getByLabel(QUESTION_BANK.q_org).fill("警察を名乗る人からの電話です");
  await page.getByLabel(QUESTION_BANK.q_request).fill("口座を調べると言われています");
  await page.getByRole("button", { name: "回答して確認する" }).click();

  await expect(page.getByRole("heading", { name: "危険サイン" })).toBeVisible();
  await expect(
    page.getByText("警察官を名乗り口座やお金の確認を求める手口の事例が公的資料にあります"),
  ).toBeVisible();
});

test("対象外入力では専用案内を表示し、原入力を編集して再送信できる", async ({ page }) => {
  await loginWithPin(page);
  const input = page.getByLabel("相談内容");
  await input.fill("今日の夕飯の献立を考えてください。");
  await page.getByRole("button", { name: "この内容で確認する" }).click();

  await expect(page.getByRole("heading", { name: "MATTAの対象外の内容です" })).toBeVisible();
  await expect(page.getByText("不審な電話・メッセージ・勧誘")).toBeVisible();
  await expect(page.getByRole("heading", { name: "危険サイン" })).toBeHidden();
  await expect(page.getByText("#9110").first()).toBeHidden();
  await expect(page.getByTestId("inspector")).toBeHidden();
  await expect(input).toHaveValue("今日の夕飯の献立を考えてください。");
  await expect(page.getByRole("button", { name: "新しい相談をはじめる" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  await input.fill("警察を名乗る人がビデオ通話で警察手帳を見せ、誰にも話すなと言っています。");
  await expect(page.getByRole("heading", { name: "MATTAの対象外の内容です" })).toBeHidden();
  await page.getByRole("button", { name: "この内容で確認する" }).click();
  await expect(page.getByRole("heading", { name: "危険サイン" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("Issue #8相当では未確認の固定質問を出し、根拠がなければ停止する", async ({ page }) => {
  await loginWithPin(page);
  await page
    .getByLabel("相談内容")
    .fill("登録している人材派遣会社から求人の案内が届き、勤務先の面接を受けるよう求められました。ほかの情報はありません。");
  await page.getByRole("button", { name: "この内容で確認する" }).click();

  await expect(page.getByLabel(QUESTION_BANK.q_official_route)).toBeVisible();
  await expect(page.getByLabel(QUESTION_BANK.q_additional_request)).toBeVisible();
  await expect(page.getByLabel(QUESTION_BANK.q_request)).toBeHidden();
  await page.getByLabel(QUESTION_BANK.q_official_route).fill("公式サイトにも案内があります");
  await page.getByLabel(QUESTION_BANK.q_additional_request).fill("追加の要求はありません");
  await page.getByRole("button", { name: "回答して確認する" }).click();

  await expect(
    page.getByRole("heading", { name: "十分な根拠が見つかりませんでした" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "危険サイン" })).toBeHidden();
});

test("Issue #9相当では一致する警察なりすましの事実だけで完走する", async ({ page }) => {
  await loginWithPin(page);
  await page
    .getByLabel("相談内容")
    .fill("警察を名乗る人がビデオ通話で警察手帳を見せ、誰にも話すなと言っています。運動していますかとも聞かれました。");
  await page.getByRole("button", { name: "この内容で確認する" }).click();

  await expect(page.getByRole("heading", { name: "危険サイン" })).toBeVisible();
  const generated = page.locator('[aria-label="確認結果"]');
  await expect(generated).toContainText("警察を名乗る");
  await expect(generated).toContainText("ビデオ通話");
  await expect(generated).toContainText("警察手帳");
  await expect(generated).toContainText("誰にも話すな");
  await expect(generated).not.toContainText("運動していますか");
  await expectNoHorizontalScroll(page);
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
