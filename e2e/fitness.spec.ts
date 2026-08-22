import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

// Scoped deliberately to /fitness/workouts only (Opus Lead, 2026-08-22) — the
// /fitness screen itself is still Engineer A's Phase 3 in progress (four
// modules being rebuilt); anything written against today's interim panel
// there would be thrown away. See the skipped placeholder at the bottom.
//
// playwright.config.ts runs fully serial against ONE real live account with
// no data isolation — every test here creates only a distinctively-named
// throwaway plan (or, for the template test, a real template plan it tears
// back down) and deletes it before finishing, wrapped in try/finally so
// cleanup runs even if an assertion above it fails, and never leaves a slot
// pointed at test data.

const TEST_PLAN_NAME = "E2E Fitness Test Plan";

async function deleteTestPlanIfPresent(page: import("@playwright/test").Page) {
  await deletePlanRowIfPresent(page, TEST_PLAN_NAME);
}

async function deletePlanRowIfPresent(page: import("@playwright/test").Page, planName: string) {
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
async function selectOrCreateExercise(page: import("@playwright/test").Page, name: string) {
  await page.getByLabel("Search exercises").fill(name);
  const exactMatch = page.getByRole("button", { name, exact: true });
  if (await exactMatch.isVisible().catch(() => false)) {
    await exactMatch.click();
    return;
  }
  await page.getByRole("button", { name: `+ Add "${name}" as a new exercise` }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
}

test("create-from-scratch: a micro plan can be built, appears in the list, and is deletable", async ({ page }) => {
  await page.goto("/fitness/workouts");
  await dismissCheckinDialogIfPresent(page);
  await deleteTestPlanIfPresent(page); // clears any stray copy from a previously-interrupted run

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
  }
});

test("activate and delete-with-active-warning: activating a plan updates the slot, deleting it clears the slot and restores whatever was active before", async ({
  page,
}) => {
  await page.goto("/fitness/workouts");
  await dismissCheckinDialogIfPresent(page);
  await deleteTestPlanIfPresent(page);

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
  }
});

test("create-from-template: choosing Starter Reps materializes and activates it, restoring whatever was active before", async ({
  page,
}) => {
  await page.goto("/fitness/workouts");
  await dismissCheckinDialogIfPresent(page);

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
  }
});

// The /fitness screen itself (Daily Log, This week, Cycle Progress checks)
// is Engineer A's Phase 3, still in progress as of this file — do not write
// against today's interim panel there. Un-skip and fill in once Phase 3 is
// reported stable.
test.skip("fitness screen: Daily Log / This week / Cycle Progress checks (Phase 3, not yet stable)", async () => {});
