import { test, expect } from "@playwright/test";

// Every test in this file relies on the shared authenticated session from
// the "setup" project (e2e/auth.setup.ts / playwright.config.ts's
// storageState) rather than logging in itself.

test.describe("Home", () => {
  test("renders hero, pulse strip, and priority list", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Mark done" }).or(page.getByText("all clear"))).toBeVisible();
    for (const domain of ["Deen", "Business", "Fitness", "School"]) {
      // Match the pulse-strip ring link specifically (accessible name "N%
      // Deen") rather than any nav link — Fitness has no direct top-level
      // nav link on the mobile island (it lives behind the "More" popover),
      // but the pulse strip always renders all four regardless of viewport.
      await expect(page.getByRole("link", { name: new RegExp(`\\d+% ${domain}`) })).toBeVisible();
    }

    // Priority list section headings or the empty-state copy are the only
    // two valid rendered states for this account at any given moment.
    const hasSections = await page.getByRole("heading", { name: /Right now|Later today/ }).count();
    const hasEmptyState = await page.getByText(/Nothing due right now|all clear/).count();
    expect(hasSections + hasEmptyState).toBeGreaterThan(0);
  });

  test("toggling a visible item updates its state without a full page reload", async ({ page }) => {
    await page.goto("/");

    // Adhkar items are the most reliably-present, safely-revertible toggle
    // on Home (a real flip, not a one-way completion like prayers/kill-list) —
    // see toggleAdhkar in app/(app)/deen/actions.ts.
    const anyToggle = page.getByRole("button", { name: /Mark "(Morning|Evening) adhkar" done/ });

    if ((await anyToggle.count()) === 0) {
      test.skip(true, "No adhkar item currently due in this account — nothing to toggle in this run");
    }

    const label = (await anyToggle.first().getAttribute("aria-label")) ?? "";
    const period = label.includes("Morning") ? "Morning" : "Evening";

    // Pinned to this exact accessible name, not `.first()` of the shared
    // regex — once this button's item completes and disappears, `.first()`
    // would silently re-resolve to the OTHER adhkar item's still-visible
    // button instead of correctly reporting "not found."
    const toggleButton = page.getByRole("button", { name: `Mark "${period} adhkar" done` });

    const urlBefore = page.url();

    await toggleButton.click();
    await expect(toggleButton).toBeHidden();
    expect(page.url()).toBe(urlBefore);

    // Revert via the dedicated Deen toggle (same underlying action, a real
    // flip) so this run doesn't leave the real account's data altered.
    await page.goto("/deen");
    await page.getByRole("button", { name: `${period} adhkar` }).click();
  });

  test("renders the responsive nav matching the current viewport", async ({ page }, testInfo) => {
    await page.goto("/");

    const mobileIsland = page.locator('[data-testid="mobile-island-item-home"]');
    const desktopSettingsLink = page.getByRole("link", { name: "Settings" });

    if (testInfo.project.name === "Mobile Chrome") {
      await expect(mobileIsland).toBeVisible();
      await expect(desktopSettingsLink).toBeHidden();
    } else {
      await expect(desktopSettingsLink).toBeVisible();
      await expect(mobileIsland).toBeHidden();
    }
  });
});
