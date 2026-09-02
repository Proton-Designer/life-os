import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

// Specs read SEED_USER_EMAIL/PASSWORD and E2E_TEST_SECRET via process.env,
// never hardcoded — Next.js loads .env.local for the app server itself, but
// the Playwright test process needs its own load to see the same values.
dotenv.config({ path: path.resolve(__dirname, ".env.local") });

// PLAYWRIGHT_BASE_URL lets Task 17.1 Step 8 point the whole suite at the
// deployed production URL instead of localhost — same specs, no changes.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const isLocal = baseURL.startsWith("http://localhost");

export default defineConfig({
  testDir: "./e2e",
  // Every project below drives the SAME single real account against the
  // SAME live Supabase project — there's no per-test or per-project data
  // isolation. Desktop Chrome and Mobile Chrome running a mutating spec
  // concurrently caused a real race (both racing to log/restore today's Isha
  // prayer status, leaving a stray row neither cleanup path caught).
  // Correctness matters far more than speed here, so this always runs fully
  // serial — not just in CI.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      // The domains-mode fixture (R41). Its own project and its own
      // storageState path — never the shared one, since two writers on
      // playwright/.auth/user.json is what corrupted it before.
      name: "Domains Fixture",
      testMatch: /.*\.domains\.spec\.ts/,
      use: { ...devices["Pixel 7"], storageState: "playwright/.auth/seed-domains.json" },
      dependencies: ["setup"],
    },
    {
      name: "Desktop Chrome",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 7"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  // Only manage a local dev server when actually testing localhost — running
  // against the deployed production URL (Step 8) needs no local server at all.
  webServer: isLocal
    ? {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
