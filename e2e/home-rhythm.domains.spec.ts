import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

/**
 * IA-P2 -- Home's day-rhythm section, on the DOMAINS-mode fixture (seed-domains; "Domains Fixture"
 * project). WRITTEN, NOT RUN by eng2 (lead runs Playwright).
 *
 * Which card shows depends on the wall clock and the fixture's day_starts / evening_closes rows
 * (morning -> today -> wind_down from 21:00 -> done), so the assertions are about the CONTRACT per
 * state, not one fixed state: exactly one rhythm card is on Home; the retired routes land on Home;
 * the nav no longer lists Today/Review. The Start-day flow only runs when the Morning card is up.
 * STATE: Start day writes today's idempotent day_starts row (can't be undone from the UI); the test
 * that taps it skips itself unless the morning card is showing.
 */
test.describe.configure({ mode: "serial" });

const CARDS = ["rhythm-morning", "rhythm-today", "rhythm-wind-down", "rhythm-done"] as const;

test("Home shows exactly one rhythm card", async ({ page }) => {
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);
  await expect
    .poll(async () => {
      let n = 0;
      for (const id of CARDS) n += await page.getByTestId(id).count();
      return n;
    })
    .toBe(1);
});

test("/open, /open/today and /close/replan land on Home", async ({ page }) => {
  for (const path of ["/open", "/open/today", "/close/replan"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
  }
});

test("the nav no longer lists Today or Review", async ({ page }) => {
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);
  await expect(page.getByRole("link", { name: /^today$/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^review$/i })).toHaveCount(0);
});

test("Morning card: Start day flips at once and the Today strip replaces it", async ({ page }) => {
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);
  test.skip((await page.getByTestId("rhythm-morning").count()) === 0, "Morning card not showing (time of day / Start day already tapped)");
  await page.getByTestId("start-day").click();
  await expect(page.getByTestId("start-day")).toHaveText("Day started");
  await expect(page.getByTestId("rhythm-today")).toBeVisible({ timeout: 15_000 });
});

test("Re-plan opens today's plan in a dialog without leaving Home", async ({ page }) => {
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);
  test.skip((await page.getByTestId("replan-open").count()) === 0, "Morning card not showing");
  await page.getByTestId("replan-open").click();
  await expect(page.getByRole("dialog", { name: "Re-plan today" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("Wind-down card opens the evening close", async ({ page }) => {
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);
  test.skip((await page.getByTestId("close-the-day").count()) === 0, "Wind-down card not showing (before 21:00 local or day already closed)");
  await page.getByTestId("close-the-day").click();
  await expect(page).toHaveURL(/\/close$/);
});
