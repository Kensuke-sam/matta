import { defineConfig, devices } from "@playwright/test";

/**
 * 本番デモUI完走ゲート専用のPlaywright設定（webServerなし・実デプロイ先へ接続）。
 *
 *   npm run gate:ui                       # 既定: 本番URLへ3回連続
 *   GATE_URL=<URL> npm run gate:ui        # 対象URLを変更（localhost版の確認等）
 *   GATE_RUNS=1 npm run gate:ui           # 回数を変更
 *
 * PINは環境変数MATTA_VERIFY_PIN、無ければmatta/.env.localのMATTA_VERIFY_PIN行から
 * 読む（specファイル側で解決。値はログへ出さない）。
 * 通常のモックe2e（npm run test:e2e）とはtestDir・設定を完全に分離している。
 */
export default defineConfig({
  testDir: "./e2e-gate",
  // 1回のデモ完走SLAは60秒。ログイン・描画を含めた1テストの上限として90秒を与える
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    baseURL: process.env.GATE_URL || "https://matta-gamma.vercel.app",
  },
});
