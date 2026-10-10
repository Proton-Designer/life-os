import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent, settleRoute } from "./helpers";
import { useDeenMode } from "./deen-mode-helpers";
import { HOME_DAY_VIEW } from "../lib/home/day-view";

// These flows need Faith visible (DEEN-09): put the account in Deen Mode ON for
// the file and restore its prior value afterwards, rather than trusting fixture state.
useDeenMode(test);

// Every test in this file relies on the shared authenticated session from
// the "setup" project (e2e/auth.setup.ts / playwright.config.ts's
// storageState) rather than logging in itself.

test.describe("Home", () => {
  test("renders the Today panel, Focus module, the day's shape, This Week's Focus, and sector progress", async ({
    page,
  }) => {
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);

    // "Today" panel (renamed from "Now"; the widget key is still `now`). Scoped to the panel whose title span is exactly
    // "Today" and that holds the unified list: a plain hasText substring match would also catch other panel titles.
    const nowPanel = page.locator("[data-panel]").filter({ has: page.getByText("Today", { exact: true }) }).filter({ has: page.getByTestId("today-tasks") });
    // Every task for today in one list (plan rows say `Mark X done`, priority rows `Mark "X" done`), or the empty state.
    await expect(
      nowPanel.getByRole("button", { name: /^Mark .* done$/ }).first().or(nowPanel.getByText(/all clear|Welcome/))
    ).toBeVisible();

    // Focus module — idle (the Deep Work and Deep Study stats side by side and ONE "Lock In" button that asks which
    // kind: focus-module.tsx / focus-kind-picker.tsx, df38b81) or active (a live elapsed timer plus an End session
    // button, and "Open session →" only for a deep_work session) are the only valid states.
    const focusPanel = page.locator("[data-panel]").filter({ has: page.getByText("Focus", { exact: true }) });
    const endSessionButton = focusPanel.getByRole("button", { name: "End session" });
    if (await endSessionButton.count()) {
      await expect(endSessionButton).toBeVisible();
    } else {
      await expect(focusPanel.getByTestId("focus-stat-deep_work")).toBeVisible();
      await expect(focusPanel.getByTestId("focus-stat-deep_study")).toBeVisible();
      // ONE Lock In, and it offers BOTH kinds (opened and closed again: nothing is started).
      await focusPanel.getByRole("button", { name: "Lock In", exact: true }).click();
      const picker = page.getByTestId("day-bar-focus-picker");
      await expect(picker.getByRole("button", { name: "Deep Work", exact: true })).toBeVisible();
      await expect(picker.getByRole("button", { name: "Deep Study", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(picker).toBeHidden();
    }

    // The day's shape (2026-08-17 day-shape spec — revived DayRibbon with
    // spans + overlay). Either the real ribbon (a headline subtitle is
    // always present when rendered — 2026-08-25/26 batch 2, item 1a: a
    // static schedule summary, not prayer-status narration anymore) or, if
    // no location is set yet, its EmptyState fallback pointing at Settings.
    // HOME-02 (2026-10-04): in the default "bar" view (lib/home/day-view.ts) the day's shape lives
    // inside the rhythm card's Day bar, so the classic panel must be gone and the rhythm card present.
    const dayShapePanel = page.locator("[data-panel]", { hasText: "The day's shape" });
    if (HOME_DAY_VIEW === "classic") {
      await expect(
        dayShapePanel
          .getByText(/Nothing scheduled today|You have .* today/)
          .or(dayShapePanel.getByText("Set your location in Settings"))
      ).toBeVisible();
    } else {
      await expect(page.locator('[data-testid^="rhythm-"]').first()).toBeVisible();
      await expect(dayShapePanel).toHaveCount(0);
    }

    // This Week's Focus — the combined goals module (2026-08-24: replaced
    // the separate bottom "This week's focus" Panel; not a [data-panel] at
    // all, see weekly-goals-header.tsx's data-testid). Deen and Business are
    // always labeled whether a goal is set this week or not, and — since
    // this module is now the ONLY place weekly goals are editable — each
    // slot's edit pencil must be present too, or a regression here would
    // silently make goals uneditable with no other signal.
    const weeklyGoalsHeader = page.getByTestId("weekly-goals-header");
    await expect(weeklyGoalsHeader.getByText("This Week's Focus")).toBeVisible();
    await expect(weeklyGoalsHeader.getByText("Faith", { exact: true })).toBeVisible();
    await expect(weeklyGoalsHeader.getByText("Business", { exact: true })).toBeVisible();
    await expect(weeklyGoalsHeader.getByRole("button", { name: "Edit Faith goal" })).toBeVisible();
    await expect(weeklyGoalsHeader.getByRole("button", { name: "Edit Business goal" })).toBeVisible();

    // Sector progress (DomainStatusStack, not wrapped in a Panel — see its
    // own component comment) — checked via each row's own metric text.
    await expect(page.getByText("Sector progress")).toBeVisible();
    // Either form is correct, and which one shows is a function of the
    // clock, not of the code: DomainStatusStack deliberately renders "Not
    // tracked yet" while the Deen day is still open and nothing has been
    // logged (deenDayOpenWithNothingLogged), and only switches to "N/5
    // prayers" once something is. A run just after local midnight — before
    // any prayer exists for the new day — therefore saw the first form and
    // failed a spec that only allowed the second, which is a defect in the
    // assertion, not in the app (found 2026-08-27 at 00:12 CDT).
    await expect(page.getByText(/\d\/5 prayers|Not tracked yet/).first()).toBeVisible();
    // \d+/\d+, not \d/3: domain-status-stack.tsx renders
    // `${killListDone}/${killListTotal || 3}`, where killListTotal is the
    // ACTUAL number of kill-list rows today — it only falls back to 3 when
    // there are none. Hardcoding /3 therefore asserted "SEED has either zero
    // or exactly three kill-list items", which is a fact about test-account
    // data, not about Home rendering. One real row put there through the UI
    // made it render "0/1" and fail (2026-08-28).
    await expect(page.getByText(/Kill list \d+\/\d+/)).toBeVisible();
    await expect(page.getByText(/% this week/)).toBeVisible();
    await expect(page.getByText(/due today/).first()).toBeVisible();
  });

  test("Home no longer renders the deleted priority-list panel or Signal:Noise donut", async ({ page }) => {
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);

    await expect(page.getByText("Right now / Later today")).not.toBeVisible();
    await expect(page.getByText("Signal:Noise this week")).not.toBeVisible();
  });

  test("toggling a visible item in the Today panel updates its state without a full page reload", async ({
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
    // settleRoute FIRST: .count() does not auto-wait, so right after goto it
    // could read /business's loading.tsx skeleton (no <ul><li> at all there)
    // and read 0 — the loop below never runs and this test skips a slot it
    // could actually have tested.
    await settleRoute(page);

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
    // The Today panel is the only place on Home it can appear now that the
    // priority-list panel is gone, so scoping to it isn't strictly required
    // for uniqueness anymore — kept anyway so this test still targets the
    // right module if that ever changes back.
    // settleRoute FIRST: .count() below does not auto-wait, so right after
    // goto it could read Home's loading.tsx skeleton (no [data-panel] at
    // all there) and read 0 — a silent false skip of a run that actually
    // had a Business item to toggle.
    await settleRoute(page);
    const nowPanel = page.locator("[data-panel]").filter({ has: page.getByText("Today", { exact: true }) }).filter({ has: page.getByTestId("today-tasks") });
    const businessRow = nowPanel.locator("li").filter({ hasText: "Business" });
    const firstButton = businessRow.getByRole("button", { name: /^Mark ".*" done$/ }).first();

    if ((await firstButton.count()) === 0) {
      test.skip(true, "No Business item currently visible on Home in this account — nothing to toggle in this run");
    }
    // Today lists EVERY open Kill List line, so pin the button by its own name: the "first" one changes once it is ticked.
    const toggleButton = nowPanel.getByRole("button", { name: (await firstButton.getAttribute("aria-label"))!, exact: true });

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
