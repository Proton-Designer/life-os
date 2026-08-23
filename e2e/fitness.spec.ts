import { test, expect, type Page } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

// The first three specs below are scoped to /fitness/workouts; the fourth
// covers the /fitness screen itself (Daily Log, This week, Cycle Progress),
// added once A's Phase 3 rebuild of that screen landed and was reported
// stable (Opus Lead, 2026-08-23) — see that test's own header comment.
//
// playwright.config.ts runs fully serial against ONE real live account with
// no data isolation — every test here creates only a distinctively-named
// throwaway plan (or, for the template test, a real template plan it tears
// back down) and deletes it before finishing, wrapped in try/finally so
// cleanup runs even if an assertion above it fails, and never leaves a slot
// pointed at test data. Every test also captures a full residue baseline
// before mutating anything and reconciles back to it at the very end —
// see fitnessResidueSnapshot's comment for why that replaced a
// hand-maintained "check these tables" list.

const TEST_PLAN_NAME = "E2E Fitness Test Plan";

async function deleteTestPlanIfPresent(page: Page) {
  await deletePlanRowIfPresent(page, TEST_PLAN_NAME);
}

async function deletePlanRowIfPresent(page: Page, planName: string) {
  const li = page.locator("li").filter({ hasText: planName });
  if (!(await li.isVisible().catch(() => false))) return;
  await li.getByRole("button", { name: "Delete" }).click();
  // Two possible confirm strings depending on whether it's the active plan
  // (plan-list.tsx) — click whichever "Delete" appears in the confirm row.
  await li.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("li").filter({ hasText: planName })).toHaveCount(0);
}

/**
 * The SEED test account (distinct from whichever account has real exercise
 * data — verified by hand this session) starts with an EMPTY exercise
 * library, so this can't assume any exercise already exists. Falls back to
 * the picker's own "+ Add as a new exercise" flow, which is idempotent in
 * practice: once created, later runs find it via the exact-match branch
 * instead of creating a duplicate.
 */
async function selectOrCreateExercise(page: Page, name: string) {
  await page.getByLabel("Search exercises").fill(name);
  const exactMatch = page.getByRole("button", { name, exact: true });
  if (await exactMatch.isVisible().catch(() => false)) {
    await exactMatch.click();
    return;
  }
  await page.getByRole("button", { name: `+ Add "${name}" as a new exercise` }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
}

/**
 * Enumerates every table the fitness-plan feature touches, against the
 * CURRENT list rather than a hand-maintained subset from whenever a given
 * test was written — that's exactly how a stray fitness_cycle_anchor row
 * escaped an earlier version of this cleanup (Opus Lead, 2026-08-23): that
 * check only knew about workout_plans/active_workout_plans/exercises, and
 * the feature grew tables out from under it.
 *
 * Captured as a BASELINE at the start of every test, before anything is
 * mutated, and reconciled back to (not asserted as a hardcoded all-zero
 * shape) at the end via reconcileFitnessBaseline — a test that restores a
 * real PRIOR active plan legitimately ends with a non-null active slot,
 * and the correct assertion is "back to what it was," not "empty." On this
 * account the baseline has in practice always been all-zero/null, so this
 * is a strict superset of that, not a weaker check.
 */
async function fitnessResidueSnapshot(page: Page, baseURL: string | undefined, secret: string) {
  const res = await page.request.get(`${baseURL}/api/test/fitness-residue`, {
    headers: { "x-e2e-secret": secret },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

/**
 * Reconciles back to the captured baseline. The one table with no UI undo
 * path at all (fitness_cycle_anchor — app/(app)/fitness/page.tsx
 * deliberately never deletes it on deactivation, so a returning user's real
 * cycle history survives) is cleared via the test-only route whenever this
 * test's own activity is what created it; everything else is expected to
 * already match given each test's own UI-based teardown runs first.
 */
async function reconcileFitnessBaseline(
  page: Page,
  baseURL: string | undefined,
  secret: string,
  baseline: Awaited<ReturnType<typeof fitnessResidueSnapshot>>
) {
  // Polled, not a single snapshot: PlanWorkoutsClient dispatches its
  // delete/activate/deactivate optimistic update BEFORE awaiting the
  // server action (true optimism, see that component's own comment), so
  // the UI can show "gone" a beat before the underlying DB write actually
  // commits. Caught live, 2026-08-23: a one-shot residue check right after
  // the UI confirmed deletion read the row mid-flight and failed a test
  // whose cleanup was, in fact, correct — just not finished yet.
  const initial = await fitnessResidueSnapshot(page, baseURL, secret);
  if (initial.fitnessCycleAnchor > baseline.fitnessCycleAnchor) {
    const res = await page.request.delete(`${baseURL}/api/test/clear-fitness-cycle-anchor`, {
      headers: { "x-e2e-secret": secret },
    });
    expect(res.ok()).toBe(true);
  }
  await expect
    .poll(async () => fitnessResidueSnapshot(page, baseURL, secret), { timeout: 10_000, intervals: [250, 500, 1000] })
    .toEqual(baseline);
}

test("create-from-scratch: a micro plan can be built, appears in the list, and is deletable", async ({ page, baseURL }) => {
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) test.skip(true, "E2E_TEST_SECRET not set — see .env.local");

  await page.goto("/fitness/workouts");
  await dismissCheckinDialogIfPresent(page);
  await deleteTestPlanIfPresent(page); // clears any stray copy from a previously-interrupted run
  const baseline = await fitnessResidueSnapshot(page, baseURL, secret!);

  try {
    await page.getByRole("button", { name: "+ Create workout" }).click();
    await page.getByRole("button", { name: "Create from scratch" }).click();
    await page.getByLabel("New workout name").fill(TEST_PLAN_NAME);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /^Micro/ }).click();
    await selectOrCreateExercise(page, "Pull-ups");
    await expect(page.getByTestId("micro-row-0")).toBeVisible();

    await page.getByRole("button", { name: /^Save/ }).click();
    await expect(page.getByTestId("plan-list")).toBeVisible();
    await expect(page.locator("li").filter({ hasText: TEST_PLAN_NAME })).toBeVisible();
  } finally {
    await deleteTestPlanIfPresent(page);
    await reconcileFitnessBaseline(page, baseURL, secret!, baseline);
  }
});

test("activate and delete-with-active-warning: activating a plan updates the slot, deleting it clears the slot and restores whatever was active before", async ({
  page,
  baseURL,
}) => {
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) test.skip(true, "E2E_TEST_SECRET not set — see .env.local");

  await page.goto("/fitness/workouts");
  await dismissCheckinDialogIfPresent(page);
  await deleteTestPlanIfPresent(page);
  const baseline = await fitnessResidueSnapshot(page, baseURL, secret!);

  const microSlot = page.getByTestId("active-slot-micro");
  const priorActiveText = (await microSlot.textContent()) ?? "";
  // "none selected" has no plan row to reactivate; anything else is a real
  // plan name we must restore by re-activating that same row afterward.
  const priorActiveName = priorActiveText.includes("none selected")
    ? null
    : (await microSlot.locator("span").last().textContent())?.trim() || null;

  try {
    await page.getByRole("button", { name: "+ Create workout" }).click();
    await page.getByRole("button", { name: "Create from scratch" }).click();
    await page.getByLabel("New workout name").fill(TEST_PLAN_NAME);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /^Micro/ }).click();
    await selectOrCreateExercise(page, "Pull-ups");
    await page.getByRole("button", { name: /^Save/ }).click();

    const testRow = page.locator("li").filter({ hasText: TEST_PLAN_NAME });
    await expect(testRow).toBeVisible();

    await testRow.getByRole("button", { name: "Activate" }).click();
    await expect(microSlot).toContainText(TEST_PLAN_NAME);

    await testRow.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("This is your active plan. Delete anyway?")).toBeVisible();
    await testRow.getByRole("button", { name: "Delete" }).click();

    await expect(page.locator("li").filter({ hasText: TEST_PLAN_NAME })).toHaveCount(0);
    await expect(microSlot).toContainText("none selected");
  } finally {
    await deleteTestPlanIfPresent(page);
    if (priorActiveName) {
      const priorRow = page.locator("li").filter({ hasText: priorActiveName });
      if (await priorRow.getByRole("button", { name: "Activate" }).isVisible().catch(() => false)) {
        await priorRow.getByRole("button", { name: "Activate" }).click();
        await expect(microSlot).toContainText(priorActiveName);
      }
    }
    await reconcileFitnessBaseline(page, baseURL, secret!, baseline);
  }
});

test("create-from-template: choosing Starter Reps materializes and activates it, restoring whatever was active before", async ({
  page,
  baseURL,
}) => {
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) test.skip(true, "E2E_TEST_SECRET not set — see .env.local");

  await page.goto("/fitness/workouts");
  await dismissCheckinDialogIfPresent(page);
  const baseline = await fitnessResidueSnapshot(page, baseURL, secret!);

  const microSlot = page.getByTestId("active-slot-micro");
  const priorText = (await microSlot.textContent()) ?? "";
  const alreadyStarterReps = priorText.includes("Starter Reps");
  // createPlanFromTemplate is idempotent by name (find-or-create) — if
  // Starter Reps is already the active micro plan, re-choosing it is a
  // verified no-op and there's nothing to clean up afterward. Otherwise
  // (empty account, or some other plan active) this genuinely materializes
  // and activates it, so it must be torn down and the prior state restored.
  const priorActiveName =
    alreadyStarterReps || priorText.includes("none selected")
      ? null
      : (await microSlot.locator("span").last().textContent())?.trim() || null;

  try {
    await page.getByRole("button", { name: "+ Create workout" }).click();
    await page.getByRole("button", { name: "Start from a template" }).click();
    await page.getByRole("button", { name: /^Starter Reps/ }).click();

    await expect(page.getByTestId("plan-list")).toBeVisible();
    await expect(microSlot).toContainText("Starter Reps");
  } finally {
    if (!alreadyStarterReps) {
      await deletePlanRowIfPresent(page, "Starter Reps");
      if (priorActiveName) {
        const priorRow = page.locator("li").filter({ hasText: priorActiveName });
        if (await priorRow.getByRole("button", { name: "Activate" }).isVisible().catch(() => false)) {
          await priorRow.getByRole("button", { name: "Activate" }).click();
          await expect(microSlot).toContainText(priorActiveName);
        }
      }
    }
    await reconcileFitnessBaseline(page, baseURL, secret!, baseline);
  }
});

// --- /fitness screen: Workout Plan strip, Daily Log, This week, Cycle
// Progress. A's Phase 3 landed and is stable (Opus Lead, 2026-08-23).
//
// This Week's per-day status is asserted as RULES computed from the
// account's own runtime state (today's day-of-week, the plan's own
// created_at), never as hardcoded day/date literals — "Thursday shows
// Missed" is true tonight and false next week once Thursday rolls out of
// the current Sun–Sat window. Same reasoning for Cycle Progress: assert
// that a cycle header appears with an active plan and the empty-state
// copy without one, never a specific cycle number or days-left count.
//
// Activating a plan here changes what Ayman's real Daily Log shows until
// it's deactivated — restored in try/finally, verified before finishing.

test("fitness screen: Workout Plan strip, Daily Log, This week, and Cycle Progress reflect an active plan", async ({
  page,
  baseURL,
}) => {
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) {
    test.skip(true, "E2E_TEST_SECRET not set — see .env.local");
  }

  await page.goto("/fitness/workouts");
  await dismissCheckinDialogIfPresent(page);
  await deleteTestPlanIfPresent(page);
  const baseline = await fitnessResidueSnapshot(page, baseURL, secret!);

  const microSlot = page.getByTestId("active-slot-micro");
  const priorActiveText = (await microSlot.textContent()) ?? "";
  const priorActiveName = priorActiveText.includes("none selected")
    ? null
    : (await microSlot.locator("span").last().textContent())?.trim() || null;

  // Baseline: with nothing active yet, Cycle Progress must show the
  // empty-state copy, not a fabricated cycle.
  await page.goto("/fitness");
  await dismissCheckinDialogIfPresent(page);
  if (!priorActiveName) {
    await expect(page.getByText("Activate a workout plan to start tracking cycles.")).toBeVisible();
  }

  let toggledCheckKind: "protein" | "steps" | null = null;

  try {
    // Everyday schedule guarantees today is included regardless of what day
    // this happens to run — the day-of-week-specific assertions below still
    // derive "today" from the page itself, not from this choice.
    await page.goto("/fitness/workouts");
    await dismissCheckinDialogIfPresent(page);
    await page.getByRole("button", { name: "+ Create workout" }).click();
    await page.getByRole("button", { name: "Create from scratch" }).click();
    await page.getByLabel("New workout name").fill(TEST_PLAN_NAME);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /^Micro/ }).click();
    await selectOrCreateExercise(page, "Pull-ups");
    await page.getByTestId("schedule-picker").getByRole("button", { name: "Everyday", exact: true }).click();
    await page.getByRole("button", { name: /^Save/ }).click();

    const testRow = page.locator("li").filter({ hasText: TEST_PLAN_NAME });
    await expect(testRow).toBeVisible();
    const testRowTestId = await testRow.getAttribute("data-testid");
    const testPlanId = testRowTestId!.replace("plan-row-", "");
    await testRow.getByRole("button", { name: "Activate" }).click();
    await expect(microSlot).toContainText(TEST_PLAN_NAME);

    // /fitness/workouts' own optimistic update can show "activated" a beat
    // before the underlying setActiveSlot write actually commits (same
    // class of race as reconcileFitnessBaseline's — see its comment).
    // /fitness reads active_workout_plans fresh on the server, so
    // navigating there too early can still render "none selected" even
    // though the click genuinely worked. Poll the DB-backed residue
    // endpoint until the write is confirmed committed before moving on.
    await expect
      .poll(async () => (await fitnessResidueSnapshot(page, baseURL, secret!)).activeMicroPlanId, {
        timeout: 10_000,
        intervals: [250, 500, 1000],
      })
      .toBe(testPlanId);

    await page.goto("/fitness");
    await dismissCheckinDialogIfPresent(page);

    // Workout Plan strip
    await expect(page.getByText(`Workout Plan: ${TEST_PLAN_NAME}`)).toBeVisible();

    // Daily Log: the micro exercise is present and not yet complete.
    await expect(page.getByTestId("daily-log-list")).toBeVisible();
    const microRow = page.locator('[data-testid^="daily-log-micro_total-"]').filter({ hasText: "Pull-ups" });
    await expect(microRow).toBeVisible();

    // Completing an item: a daily_check, since the server only ever
    // renders it here at all via pendingDailyLog (daily-log.ts), which
    // filters completed items out entirely — so a rendered check is
    // ALWAYS currently pending, never already-done; there's no direction
    // ambiguity to capture. Tries protein first, falls back to steps (the
    // only other daily_check archetype) in the vanishingly unlikely case
    // both are already completed for real today. Aimed at the micro-goal/
    // daily-check archetypes only — A's own pass covers the session-confirm
    // path end to end (Opus Lead, 2026-08-23), not duplicated here.
    const proteinRow = page.getByTestId("daily-log-check-protein");
    const stepsRow = page.getByTestId("daily-log-check-steps");
    if (await proteinRow.isVisible().catch(() => false)) {
      await proteinRow.click();
      toggledCheckKind = "protein";
      await expect(proteinRow).toHaveCount(0, { timeout: 10000 });
    } else if (await stepsRow.isVisible().catch(() => false)) {
      await stepsRow.click();
      toggledCheckKind = "steps";
      await expect(stepsRow).toHaveCount(0, { timeout: 10000 });
    }

    // This week: derive "today" and "the day before this plan existed"
    // from the page's own rendered dates rather than a hardcoded literal.
    const todayCell = page.locator('[data-testid^="this-week-day-"][class*="border-accent-info"]');
    await expect(todayCell).toBeVisible();
    const todayTestId = await todayCell.getAttribute("data-testid");
    const todayDateStr = todayTestId!.replace("this-week-day-", "");

    // Rule: today, scheduled and not yet met, is "Today" (WeekDayStatus
    // "active" — this component's own label, see this-week-calendar.tsx).
    await expect(todayCell.getByText("Today", { exact: true })).toBeVisible();
    await expect(todayCell.getByText("Pull-ups", { exact: false })).toBeVisible();

    // Rule: a day before the plan's own creation date has no status chip
    // at all, even though "Everyday" would otherwise schedule it. Only
    // meaningful if yesterday is still in this Sun–Sat week (today isn't
    // Sunday); the plan was created today, so yesterday is guaranteed
    // before its start.
    const [y, m, d] = todayDateStr.split("-").map(Number);
    const todayDate = new Date(Date.UTC(y, m - 1, d));
    const isSunday = todayDate.getUTCDay() === 0;
    if (!isSunday) {
      const yesterday = new Date(todayDate);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      const yesterdayCell = page.getByTestId(`this-week-day-${yesterdayStr}`);
      await expect(yesterdayCell).toBeVisible();
      for (const label of ["Completed", "Today", "Upcoming", "Missed"]) {
        await expect(yesterdayCell.getByText(label, { exact: true })).toHaveCount(0);
      }
    }

    // Rule: a scheduled future day this week is "Upcoming". Only
    // meaningful if today isn't Saturday (no "later this week" to check).
    const isSaturday = todayDate.getUTCDay() === 6;
    if (!isSaturday) {
      const tomorrow = new Date(todayDate);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);
      const tomorrowCell = page.getByTestId(`this-week-day-${tomorrowStr}`);
      await expect(tomorrowCell).toBeVisible();
      await expect(tomorrowCell.getByText("Upcoming", { exact: true })).toBeVisible();
    }

    // Cycle Progress: a cycle header now appears (never assert the exact
    // number/days-left — both age out with real time).
    await expect(page.getByTestId("cycle-progress-panel")).toBeVisible();
    await expect(page.getByTestId("cycle-progress-panel").getByText(/^Cycle \d+$/)).toBeVisible();
  } finally {
    if (toggledCheckKind) {
      // Restores to "not logged today" — the state it was ALWAYS in before
      // this test touched it (a rendered daily_check is never already-done,
      // see the comment above), via the test-only route rather than the
      // app's UI: once completed, the item has no button left to undo it
      // through, same problem class as clear-prayer.
      const cleanupCheck = await page.request.delete(`${baseURL}/api/test/clear-daily-check`, {
        headers: { "x-e2e-secret": secret! },
        data: { kind: toggledCheckKind },
      });
      expect(cleanupCheck.ok()).toBe(true);
    }

    await page.goto("/fitness/workouts");
    await dismissCheckinDialogIfPresent(page);
    await deleteTestPlanIfPresent(page);
    if (priorActiveName) {
      const priorRow = page.locator("li").filter({ hasText: priorActiveName });
      if (await priorRow.getByRole("button", { name: "Activate" }).isVisible().catch(() => false)) {
        await priorRow.getByRole("button", { name: "Activate" }).click();
        await expect(microSlot).toContainText(priorActiveName);
      }
    }
    await reconcileFitnessBaseline(page, baseURL, secret!, baseline);
  }
});
