import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export const E2E_PIN = "matta-e2e-pin";

export async function loginWithPin(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("PIN").fill(E2E_PIN);
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(
    page.getByRole("heading", { name: "いま受けている連絡について教えてください" }),
  ).toBeVisible();
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const ok = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(ok).toBe(true);
}
