import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

// Every test in this file relies on the shared authenticated session from
// the "setup" project (e2e/auth.setup.ts / playwright.config.ts's
// storageState) rather than logging in itself.

test.describe("Home", () => {
  test("renders the Now module, Focus module, the day's shape, This Week's Focus, and sector progress", async ({
    page,
  }) => {
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);

    // "Now" module. Scoped to the panel whose title span is exactly "Now" —
    // a plain hasText substring match would also catch other panel titles.
    const nowPanel = page.locator("[data-panel]").filter({ has: page.getByText("Now", { exact: true }) });
    await expect(
      nowPanel.getByRole("button", { name: /^Mark ".*" done$/ }).first().or(nowPanel.getByText(/all clear|Welcome/))
    ).toBeVisible();

    // Focus module — idle (both Deep Work and Deep Study rows, each with its
    // own Lock In button distinguished by accessible name — see
    // focus-module.tsx's aria-label, 2026-08-24 Deep Work/Deep Study split)
    // or active (a live elapsed timer plus an End session button, and
    // "Open session →" only for a deep_work session) are the only valid
    // states.
    const focusPanel = page.locator("[data-panel]").filter({ has: page.getByText("Focus", { exact: true }) });
    const endSessionButton = focusPanel.getByRole("button", { name: "End session" });
    if (await endSessionButton.count()) {
      await expect(endSessionButton).toBeVisible();
    } else {
      await expect(focusPanel.getByRole("button", { name: "Lock In — Deep Work" })).toBeVisible();
      await expect(focusPanel.getByRole("button", { name: "Lock In — Deep Study" })).toBeVisible();
    }

    // The day's shape (2026-08-17 day-shape spec — revived DayRibbon with
    // spans + overlay). Either the real ribbon (a headline subtitle is
    // always present when rendered — 2026-08-25/26 batch 2, item 1a: a
    // static schedule summary, not prayer-status narration anymore) or, if
    // no location is set yet, its EmptyState fallback pointing at Settings.
    const dayShapePanel = page.locator("[data-panel]", { hasText: "The day's shape" });
    await expect(
      dayShapePanel
        .getByText(/Nothing scheduled today|You have .* today/)
        .or(dayShapePanel.getByText("Set your location in Settings"))
    ).toBeVisible();

    // This Week's Focus — the combined goals module (2026-08-24: replaced
    // the separate bottom "This week's focus" Panel; not a [data-panel] at
    // all, see weekly-goals-header.tsx's data-testid). Deen and Business are
    // always labeled whether a goal is set this week or not, and — since
    // this module is now the ONLY place weekly goals are editable — each
    // slot's edit pencil must be present too, or a regression here would
    // silently make goals uneditable with no other signal.
    const weeklyGoalsHeader = page.getByTestId("weekly-goals-header");
    await expect(weeklyGoalsHeader.getByText("This Week's Focus")).toBeVisible();
    await expect(weeklyGoalsHeader.getByText("Deen", { exact: true })).toBeVisible();
    await expect(weeklyGoalsHeader.getByText("Business", { exact: true })).toBeVisible();
    await expect(weeklyGoalsHeader.getByRole("button", { name: "Edit Deen goal" })).toBeVisible();
    await expect(weeklyGoalsHeader.getByRole("button", { name: "Edit Business goal" })).toBeVisible();

    // Sector progress (DomainStatusStack, not wrapped in a Panel — see its
    // own component comment) — checked via each row's own metric text.
    await expect(page.getByText("Sector progress")).toBeVisible();
    await expect(page.getByText(/\d\/5 prayers/)).toBeVisible();
    await expect(page.getByText(/Kill list \d\/3/)).toBeVisible();
    await expect(page.getByText(/% this week/)).toBeVisible();
    await expect(page.getByText(/due today/).first()).toBeVisible();
  });

  test("Home no longer renders the deleted priority-list panel or Signal:Noise donut", async ({ page }) => {
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);

    await expect(page.getByText("Right now / Later today")).not.toBeVisible();
    await expect(page.getByText("Signal:Noise this week")).not.toBeVisible();
  });

  test("toggling a visible item in the Now module updates its state without a full page reload", async ({
    page,
  }) => {
    // Adhkar (this test's original target — a real flip, not a one-way
    // completion like every other Home item type) was dropped from the UI
    // long ago. Kill-list is the next-best target: Home's own toggle is
    // one-way (completed: true, per app/(app)/actions.ts), but the Business
    // page's toggleKillListItem action flips it back, so the same
    // cross-page complete-then-revert shape still works.
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

    // Kill-list is rolled into a single Home item (per get-priority-items.ts).
    // The Now module is the only place on Home it can appear now that the
    // priority-list panel is gone, so scoping to it isn't strictly required
    // for uniqueness anymore — kept anyway so this test still targets the
    // right module if that ever changes back.
    const nowPanel = page.locator("[data-panel]").filter({ has: page.getByText("Now", { exact: true }) });
    const businessRow = nowPanel.locator("li").filter({ hasText: "Business" });
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
