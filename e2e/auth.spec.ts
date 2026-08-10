import { test, expect } from "@playwright/test";
import { login } from "./helpers";

// This spec exercises the login flow itself, so it opts out of the shared
// authenticated session every other spec relies on (project-level
// storageState from e2e/auth.setup.ts) and starts from a clean, signed-out
// context instead.
test.use({ storageState: { cookies: [], origins: [] } });

test("sign in with the seeded user redirects to Home", async ({ page }) => {
  await login(page);
  // The hero renders either a real "next up" item (title + Mark done) or
  // the all-clear empty state — either is proof Home actually rendered.
  await expect(page.getByRole("button", { name: "Mark done" }).or(page.getByText("all clear"))).toBeVisible();
});

test("unauthenticated visitors are redirected to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
