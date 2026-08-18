import { test, expect } from "@playwright/test";
import { login, dismissCheckinDialogIfPresent } from "./helpers";

// This spec exercises the login flow itself, so it opts out of the shared
// authenticated session every other spec relies on (project-level
// storageState from e2e/auth.setup.ts) and starts from a clean, signed-out
// context instead.
test.use({ storageState: { cookies: [], origins: [] } });

test("sign in with the seeded user redirects to Home", async ({ page }) => {
  await login(page);
  await dismissCheckinDialogIfPresent(page);
  // The "Now" module renders either a real item (title + `Mark "…" done`)
  // or the all-clear/fresh-install empty state — either is proof Home
  // actually rendered. Updated for the 2026-08-17 restructure: NextUpHero's
  // plain "Mark done" button is gone from Home (still live on /deen).
  await expect(
    page.getByRole("button", { name: /^Mark ".*" done$/ }).first().or(page.getByText(/all clear|Welcome/))
  ).toBeVisible();
});

test("unauthenticated visitors are redirected to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
