import { defineConfig, devices } from "@playwright/test";
import { CORPUS_VERSION } from "./lib/corpus";

// 並行セッション・常駐サーバーとの衝突回避用に、ポートは環境変数で上書きできる
function envPort(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

const APP_PORT = envPort("E2E_APP_PORT", 3971);
const MOCK_PORT = envPort("E2E_MOCK_OPENAI_PORT", 8965);
const MOCK_VECTOR_PORT = envPort("E2E_MOCK_UPSTASH_PORT", 8966);
/** Vector DB障害フォールバック検証用: Upstash接続先を閉じたポートへ向けたインスタンス */
const APP_VECTOR_DOWN_PORT = envPort("E2E_APP_VECTOR_DOWN_PORT", 3972);

// 両アプリインスタンスで共通の環境変数（モックへ向けるダミー値。実APIキーではない）
const APP_ENV = {
  OPENAI_API_KEY: "sk-mock-not-a-real-key",
  OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
  MATTA_DEMO_PIN: "matta-e2e-pin",
  MATTA_MIN_SIMILARITY: "0.3",
  MATTA_SESSION_RATE_LIMIT: "1000",
  MATTA_ANALYZE_RATE_LIMIT: "1000",
  UPSTASH_VECTOR_REST_TOKEN: "mock-not-a-real-token",
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
  },
  projects: [
    {
      name: "pc",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  // 注: e2eの正式な入口は `npm run test:e2e`（next build && playwright test）。
  // 下のnext startは既存の.nextをそのまま起動するため、
  // `npx playwright test` を単体実行する場合は先にbuildしておくこと
  webServer: [
    {
      command: "node e2e/mock-openai.mjs",
      url: `http://127.0.0.1:${MOCK_PORT}/healthz`,
      reuseExistingServer: false,
      env: { MOCK_OPENAI_PORT: String(MOCK_PORT) },
    },
    {
      command: "node e2e/mock-upstash.mjs",
      url: `http://127.0.0.1:${MOCK_VECTOR_PORT}/healthz`,
      reuseExistingServer: false,
      env: {
        MOCK_UPSTASH_PORT: String(MOCK_VECTOR_PORT),
        MOCK_UPSTASH_NAMESPACE: CORPUS_VERSION,
      },
    },
    {
      command: `npx next start -p ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        ...APP_ENV,
        UPSTASH_VECTOR_REST_URL: `http://127.0.0.1:${MOCK_VECTOR_PORT}`,
      },
    },
    {
      command: `npx next start -p ${APP_VECTOR_DOWN_PORT}`,
      url: `http://127.0.0.1:${APP_VECTOR_DOWN_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        ...APP_ENV,
        // 何も待ち受けていないポート: 接続拒否でVector DB障害を再現する
        UPSTASH_VECTOR_REST_URL: "http://127.0.0.1:9",
      },
    },
  ],
});
