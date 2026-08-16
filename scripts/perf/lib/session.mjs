// Shared helpers for the scripts/perf/*.mjs harnesses. Every harness signs
// in through the real /login form (never a bypass) against a `next start`
// production build — prefetching and the Router Cache do not behave
// realistically under `next dev`, so pointing these at a dev server will
// produce numbers that don't mean anything.
import { chromium } from "@playwright/test";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env.local") });

export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:3000";

export const ROUTES = [
  "/",
  "/deen",
  "/business",
  "/fitness",
  "/school",
  "/co-op",
  "/insights",
  "/weekly-planning",
  "/settings",
];

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set — see .env.local`);
  }
  return value;
}

export async function loginSession({ headless = true } = {}) {
  const email = requireEnv("SEED_USER_EMAIL");
  const password = requireEnv("SEED_USER_PASSWORD");
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/$/);
  return { browser, context, page };
}

// Same defensive dismiss e2e/helpers.ts uses: the real CheckinScheduler
// mounts on every authenticated page and can pop its Dialog independent of
// what a script is doing, intercepting clicks underneath it. Escape triggers
// a snooze (persists nothing), so this is safe to call unconditionally.
export async function dismissCheckinDialogIfPresent(page) {
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" }).catch(() => {});
  }
}

export function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
