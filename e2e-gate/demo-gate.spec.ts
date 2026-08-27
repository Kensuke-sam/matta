import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * 本番デモUI完走ゲート（落単回避の完成条件1・2）。
 * 実デプロイ先に対して実ブラウザで、PINログイン→ニセ警察デモ入力→送信→
 * （追加質問が出た場合は回答して）5項目表示＋根拠Top 3の描画完了までを
 * GATE_RUNS回連続で検証する。
 * APIゲート（verify:deploy --gate）と違い、JS配信・hydration・描画の破損も検出する。
 * 実OpenAI APIを消費するため、実行はデモリハーサル・発表前チェックに限る。
 */

const RUNS = Number(process.env.GATE_RUNS) || 3;
const TIME_BUDGET_MS = 60_000;

const RESULT_HEADINGS = [
  "類似する公的事例",
  "危険サイン",
  "本物なら通常こうする",
  "今、してはいけないこと",
  "安全な確認方法",
];

/** PINを環境変数か.env.localから解決する（値はログへ出さない） */
function resolvePin(): string {
  if (process.env.MATTA_VERIFY_PIN) return process.env.MATTA_VERIFY_PIN;
  try {
    // gate:uiはmatta/から実行される前提（playwright.gate.config.tsと同階層）
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^MATTA_VERIFY_PIN=(.*)$/);
      if (match) {
        let value = match[1].trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return value;
      }
    }
  } catch {
    // .env.localなし: 下のエラーへ
  }
  throw new Error(
    "MATTA_VERIFY_PIN が未設定です（環境変数、または matta/.env.local へ設定してください）。",
  );
}

test.describe.configure({ mode: "serial" });

for (let run = 1; run <= RUNS; run++) {
  test(`UI完走 ${run}/${RUNS}: PINログイン→ニセ警察デモ→5項目とTop 3根拠の表示`, async ({
    page,
  }) => {
    const pin = resolvePin();

    await page.goto("/");
    await page.getByLabel("PIN").fill(pin);
    await page.getByRole("button", { name: "はじめる" }).click();
    await expect(
      page.getByRole("heading", { name: "いま受けている連絡について教えてください" }),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "警察を名乗る電話" }).click();
    const startedAt = Date.now();
    await page.getByRole("button", { name: "この内容で確認する" }).click();

    // 実LLMトリアージは情報不足と判断すると追加質問（D-013: 固定文言・最大2問）を
    // 1画面で返す。回答送信後は再質問しない（lib/analyze.ts: answersありでは質問を返さない）。
    // 本番デモと同じ操作として、質問が出た場合は「まだ渡していない」旨を回答して先へ進む
    const resultBanner = page.getByText("まずは、相手とのやり取りをいったん止めてください。");
    const questionHeading = page.getByRole("heading", { name: "もう少しだけ教えてください" });
    await expect(resultBanner.or(questionHeading).first()).toBeVisible({
      timeout: TIME_BUDGET_MS,
    });
    if (!(await resultBanner.isVisible())) {
      const answerBoxes = page.getByRole("textbox");
      const boxCount = await answerBoxes.count();
      for (let i = 0; i < boxCount; i++) {
        await answerBoxes.nth(i).fill("まだ何も渡したり入力したりしていません。");
      }
      await page.getByRole("button", { name: "回答して確認する" }).click();
    }

    // 完走判定: 中断バナー＋5項目見出し＋審査用インスペクタのTop 3根拠が描画されるまで
    await expect(resultBanner).toBeVisible({ timeout: TIME_BUDGET_MS });
    for (const heading of RESULT_HEADINGS) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    const inspector = page.getByTestId("inspector");
    await inspector.locator("summary").click();
    await expect(page.getByTestId("similarity-0")).toBeVisible();
    await expect(page.getByTestId("similarity-0")).toHaveText(/^\d\.\d{3}$/);
    await expect(page.getByTestId("similarity-2")).toBeVisible();

    const elapsedMs = Date.now() - startedAt;
    console.log(`[gate:ui] ${run}/${RUNS} 完走 ${(elapsedMs / 1000).toFixed(1)}s`);
    expect(elapsedMs, "送信から描画完了まで60秒以内").toBeLessThanOrEqual(TIME_BUDGET_MS);

    // 次の周回を独立させる（同一ブラウザ文脈を引き継がない）
    await page.context().clearCookies();
  });
}
