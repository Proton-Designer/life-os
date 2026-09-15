import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent, dismissCheckinToastIfPresent, fillReliably } from "./helpers";

/**
 * Goals (#43/#44) end to end into #53's own reader: creates a real goal
 * with the Business domain, confirms it renders ranked on /goals, completes
 * it, then confirms it surfaces in /business's "Completed goals" archive
 * (lib/business/completed-goals.ts — filtered to domain='business',
 * status='done'). One row exercises both features rather than two specs
 * each covering half the round trip.
 *
 * MUTATING: creates a real `goals` row on SEED. There is no delete UI for
 * a goal — "Done"/"Drop" (setGoalStatusAction) both leave the row visible
 * forever in the Goals page's own "Completed & dropped" history, which is
 * correct product behavior (a real month's history) but not something this
 * spec may leave behind on Ayman's real account. Cleanup runs in `finally`
 * via app/api/test/clear-goal (its own header explains why it exists).
 */
test("create a goal with a domain, see it ranked, complete it, see it in Business's Completed goals", async ({ page, baseURL }) => {
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) {
    test.skip(true, "E2E_TEST_SECRET not set — see .env.local");
  }

  const title = `e2e-goal-${Date.now()}`;

  try {
    await page.goto("/goals");
    await dismissCheckinDialogIfPresent(page);

    const addButton = page.getByRole("button", { name: "+ Add a goal" });
    if (!(await addButton.isVisible())) {
      test.skip(true, "This account's 5 active goals are already full — no room to add a test goal without dropping a real one first.");
    }
    // The allocation check-in TOAST (role="status") fires on its own
    // window timer, independent of anything this spec does — found live
    // 2026-09-15 as a real flaky failure, on screen exactly when the Add
    // form was being opened/submitted. dismissCheckinDialogIfPresent above
    // only ever catches the full check-in SHEET (role="dialog"), a
    // different element.
    await dismissCheckinToastIfPresent(page);
    await addButton.click();

    await fillReliably(page.getByPlaceholder("Goal title"), title);
    await fillReliably(page.getByPlaceholder("Why this goal matters (required)"), "e2e reason — verifying #43/#44/#53");

    // The domain Select is the form's FIRST combobox (domain, then rank) —
    // scoped by position, not accessible name: SelectTrigger here carries
    // no explicit aria-label, and its rendered text changes with the
    // selection, so a name-based locator would be self-invalidating.
    await page.getByRole("combobox").nth(0).click();
    await page.getByRole("option", { name: "Business" }).click();

    // Same toast risk right before the mutating submit click.
    await dismissCheckinToastIfPresent(page);
    await page.getByRole("button", { name: "Add goal" }).click();

    // "see it ranked": a numeric rank badge and the Business domain label,
    // both beside the title — NOT a specific rank number, which depends on
    // how many other active goals this real account already has.
    const row = page.getByRole("listitem").filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row.getByText(/^\d+$/).first()).toBeVisible();
    await expect(row.getByText("Business")).toBeVisible();

    // "complete it" — setGoalStatusAction awaits the server before flipping
    // local state (components/goals/goal-board.tsx's ActiveGoalCard), so
    // the row disappearing here is proof the write already committed, not
    // an optimistic paint racing ahead of it. Same toast risk as the two
    // guards above — this is a separate mutating click, on a page that's
    // been sitting open since the goal was created.
    await dismissCheckinToastIfPresent(page);
    await row.getByRole("button", { name: "Done" }).click();
    await expect(row).toBeHidden();

    // "see it in /business Completed goals" — revalidatePath("/business")
    // fires from the same action (app/(app)/goals/actions.ts), so this
    // navigation is guaranteed fresh, not a stale cached render.
    await page.goto("/business");
    await dismissCheckinDialogIfPresent(page);
    const toggle = page.getByRole("button", { name: /^Completed goals/ });
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }
    await expect(page.getByText(title)).toBeVisible();
  } finally {
    await page.request
      .delete(`${baseURL}/api/test/clear-goal`, { headers: { "x-e2e-secret": secret! }, data: { title } })
      .catch(() => undefined);
  }
});
