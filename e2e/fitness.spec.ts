import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

// Scoped deliberately to /fitness/workouts only (Opus Lead, 2026-08-22) — the
// /fitness screen itself is still Engineer A's Phase 3 in progress (four
// modules being rebuilt); anything written against today's interim panel
// there would be thrown away. See the skipped placeholder at the bottom.
//
// playwright.config.ts runs fully serial against ONE real live account with
// no data isolation — every test here creates only a distinctively-named
// throwaway plan and deletes it before finishing (wrapped in try/finally so
// cleanup runs even if an assertion above it fails), and never leaves a
// slot pointed at test data. The one exception (the template test) never
// mutates anything in the first place — see its comment.

const TEST_PLAN_NAME = "E2E Fitness Test Plan";

async function deleteTestPlanIfPresent(page: import("@playwright/test").Page) {
  const row = page.getByTestId("plan-rows").getByText(TEST_PLAN_NAME, { exact: false });
  if (!(await row.isVisible().catch(() => false))) return;
  const li = page.locator("li").filter({ hasText: TEST_PLAN_NAME });
  await li.getByRole("button", { name: "Delete" }).click();
  // Two possible confirm strings depending on whether it's the active plan
  // (plan-list.tsx) — click whichever "Delete" appears in the confirm row.
  await li.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("li").filter({ hasText: TEST_PLAN_NAME })).toHaveCount(0);
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

    // "Pull-ups" already exists in this account's exercise library (the
    // starter plan uses it) — reusing it avoids permanently adding a new
    // exercise row for a throwaway test plan.
    await page.getByLabel("Search exercises").fill("Pull-ups");
    await page.getByRole("button", { name: "Pull-ups", exact: true }).click();
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
    await page.getByLabel("Search exercises").fill("Pull-ups");
    await page.getByRole("button", { name: "Pull-ups", exact: true }).click();
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

// Idempotent by design (createPlanFromTemplate finds-or-creates by name) —
// only runs when the seeded account's active micro plan is already "Starter
// Reps" (true after migration 036's data conversion), so re-choosing it is a
// verified no-op rather than a mutation this test would need to undo.
test("create-from-template: re-choosing the account's existing Starter Reps template is a no-op", async ({ page }) => {
  await page.goto("/fitness/workouts");
  await dismissCheckinDialogIfPresent(page);

  const microSlot = page.getByTestId("active-slot-micro");
  const before = await microSlot.textContent();
  test.skip(
    !before?.includes("Starter Reps"),
    "This account's active micro plan isn't Starter Reps in this run — skipping to avoid reassigning a real slot"
  );

  await page.getByRole("button", { name: "+ Create workout" }).click();
  await page.getByRole("button", { name: "Start from a template" }).click();
  await page.getByRole("button", { name: /^Starter Reps/ }).click();

  await expect(page.getByTestId("plan-list")).toBeVisible();
  await expect(microSlot).toContainText("Starter Reps");
});

// The /fitness screen itself (Daily Log, This week, Cycle Progress checks)
// is Engineer A's Phase 3, still in progress as of this file — do not write
// against today's interim panel there. Un-skip and fill in once Phase 3 is
// reported stable.
test.skip("fitness screen: Daily Log / This week / Cycle Progress checks (Phase 3, not yet stable)", async () => {});
