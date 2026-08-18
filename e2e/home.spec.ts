import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

// Every test in this file relies on the shared authenticated session from
// the "setup" project (e2e/auth.setup.ts / playwright.config.ts's
// storageState) rather than logging in itself.

test.describe("Home", () => {
  test("renders the Now module, Focus module, weekly focus, sector progress, and priority list", async ({
    page,
  }) => {
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);

    // "Now" module (2026-08-17 restructure) — one row per applicable domain
    // via a `Mark "…" done` button, or the all-clear/fresh-install empty
    // state. Scoped to the panel whose title span is exactly "Now" — a
    // plain hasText substring match would also catch the "Right now / Later
    // today" panel below, and the same `Mark "…" done` aria-label pattern
    // is reused by the priority list, so scoping matters here.
    const nowPanel = page.locator("[data-panel]").filter({ has: page.getByText("Now", { exact: true }) });
    await expect(
      nowPanel.getByRole("button", { name: /^Mark ".*" done$/ }).first().or(nowPanel.getByText(/all clear|Welcome/))
    ).toBeVisible();

    // Focus module — idle (Lock In button) or active (a live elapsed timer
    // plus "Open session →") are the only two valid states.
    const focusPanel = page.locator("[data-panel]").filter({ has: page.getByText("Focus", { exact: true }) });
    await expect(
      focusPanel.getByRole("button", { name: "Lock In" }).or(focusPanel.getByRole("link", { name: "Open session →" }))
    ).toBeVisible();

    // Weekly focus — Deen and Business blocks are always labeled, whether a
    // goal is set this week or not (see weekly-focus.tsx's GoalBlock).
    const weeklyFocusPanel = page.locator("[data-panel]", { hasText: "This week's focus" });
    await expect(weeklyFocusPanel.getByText("Deen", { exact: true })).toBeVisible();
    await expect(weeklyFocusPanel.getByText("Business", { exact: true })).toBeVisible();

    // Sector progress (the moved DomainStatusStack, no longer wrapped in a
    // Panel — see its own component comment) — checked via each row's own
    // metric text, which is unique per domain, rather than a testid the
    // shared ListRow component doesn't expose per-instance.
    await expect(page.getByText("Sector progress")).toBeVisible();
    await expect(page.getByText(/\d\/5 prayers/)).toBeVisible();
    await expect(page.getByText(/Kill list \d\/3/)).toBeVisible();
    await expect(page.getByText(/% this week/)).toBeVisible();
    await expect(page.getByText(/due today/).first()).toBeVisible();

    // Priority list section headings or the empty-state copy are the only
    // two valid rendered states for this account at any given moment.
    const hasSections = await page.getByRole("heading", { name: /Right now|Later today/ }).count();
    const hasEmptyState = await page.getByText(/Nothing due right now|all clear/).count();
    expect(hasSections + hasEmptyState).toBeGreaterThan(0);
  });

  test("toggling a visible item updates its state without a full page reload", async ({ page }) => {
    // Adhkar (this test's original target — a real flip, not a one-way
    // completion like every other Home item type) was dropped from the UI
    // in the Home/Deen/Business overhaul. Kill-list is the next-best target:
    // Home's own toggle is one-way (completed: true, per app/(app)/actions.ts),
    // but the Business page's toggleKillListItem action flips it back, so the
    // same cross-page complete-then-revert shape still works.
    await page.goto("/business");
    await dismissCheckinDialogIfPresent(page);

    const slots = page.locator("ul").first().locator("> li");
    let targetIndex = -1;
    const slotCount = await slots.count();
    for (let i = 0; i < slotCount; i++) {
      if (await slots.nth(i).getByRole("button", { name: "Mark complete" }).count()) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) {
      test.skip(true, "No populated, not-yet-completed kill-list slot in this account — nothing to toggle in this run");
    }
    const slot = slots.nth(targetIndex);

    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);

    // Kill-list is rolled into a single Home item (per get-priority-items.ts),
    // and since the 2026-08-17 restructure that same item can appear twice
    // on Home — once in the "Now" module, once here — so scoping to the
    // priority-list panel specifically (not just the "Business" domain
    // label) is required, not optional, to avoid an ambiguous match.
    const priorityListPanel = page.locator("[data-panel]", { hasText: "Right now / Later today" });
    const businessRow = priorityListPanel.locator("li").filter({ hasText: "Business" });
    const toggleButton = businessRow.getByRole("button", { name: /^Mark ".*" done$/ });

    if ((await toggleButton.count()) === 0) {
      test.skip(true, "No Business item currently visible on Home in this account — nothing to toggle in this run");
    }

    const urlBefore = page.url();

    await toggleButton.click();
    await expect(toggleButton).toBeHidden();
    expect(page.url()).toBe(urlBefore);

    // Revert via the Business page's own bidirectional toggle so this run
    // doesn't leave the real account's data altered.
    await page.goto("/business");
    await dismissCheckinDialogIfPresent(page);
    await expect(slot.getByRole("button", { name: "Mark incomplete" })).toBeVisible();
    await slot.getByRole("button", { name: "Mark incomplete" }).click();
    await expect(slot.getByRole("button", { name: "Mark complete" })).toBeVisible();
  });

  test("renders the responsive nav matching the current viewport", async ({ page }, testInfo) => {
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);

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
