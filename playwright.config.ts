import { defineConfig, devices } from "@playwright/test";

const APP_PORT = 3971;
const MOCK_PORT = 8965;

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
  webServer: [
    {
      command: "node e2e/mock-openai.mjs",
      url: `http://127.0.0.1:${MOCK_PORT}/healthz`,
      reuseExistingServer: false,
      env: { MOCK_OPENAI_PORT: String(MOCK_PORT) },
    },
    {
      command: `npx next start -p ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        // モックへ向けるダミー値。実APIキーではない
        OPENAI_API_KEY: "sk-mock-not-a-real-key",
        OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
        MATTA_DEMO_PIN: "matta-e2e-pin",
        MATTA_MIN_SIMILARITY: "0.3",
        MATTA_SESSION_RATE_LIMIT: "1000",
        MATTA_ANALYZE_RATE_LIMIT: "1000",
      },
    },
  ],
});
