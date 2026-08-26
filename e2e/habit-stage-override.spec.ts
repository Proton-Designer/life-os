import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent, clickAndSettle } from "./helpers";

// Item 6 (Habit Builder editor, 2026-08-25/26). Wired up now that C's
// editor UI landed at 36ccfc6, on top of the data layer from 5c1b16b/
// 959234a. The assertion that matters (Opus Lead): an overridden stage
// actually renders where the override says, not where the date-derived
// rule would put it.
//
// Creates a throwaway habit for this test rather than mutating one of
// SEED's real habits (same discipline as e2e/task-row-list.spec.ts's
// School task) — a freshly created habit is guaranteed to derive
// "Active Build" (0 days since committed_date = today), so overriding it
// to Stabilized is an unambiguous, real state change to assert against,
// not a coincidence of whatever real habits already existed. Cleaned up
// via archiveDeenHabit (the Remove button) at the end — archived habits
// are excluded from the page's own query (`archived = false`), so this
// is a complete and permanent removal from view, not a soft-delete that
// would leave the habit lingering for a future run to trip over.
test("an overridden stage renders where the override says, not where the derived rule would put it", async ({
  page,
}) => {
  const habitName = `Playwright override habit ${Date.now()}`;

  await page.goto("/deen");
  await dismissCheckinDialogIfPresent(page);

  const habitPanel = page.locator("[data-panel]").filter({ has: page.getByText("Habit Builder", { exact: true }) });

  // Either "Add a habit" (zero-habits empty state) or "Create New Habit"
  // (habits already exist) opens the same create form — whichever is
  // present depends on SEED's real habit count, which this test doesn't
  // control and shouldn't assume.
  const addTrigger = habitPanel.getByRole("button", { name: /^(Add a habit|Create New Habit)$/ });
  await addTrigger.click();

  const nameInput = habitPanel.getByPlaceholder("Or start a new habit");
  await nameInput.fill(habitName);
  await clickAndSettle(page, habitPanel.getByRole("button", { name: "Start" }));

  // Newly created, committed today — derives to Active Build.
  const activeBuildColumn = habitPanel.locator("h3", { hasText: "Active Build" }).locator("xpath=following-sibling::ul[1]");
  await expect(activeBuildColumn.getByText(habitName)).toBeVisible();

  // --- Open the editor and set the override ---
  await habitPanel.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const habitRow = dialog.locator("li").filter({ hasText: habitName });
  await expect(habitRow).toBeVisible();
  await expect(habitRow.getByText("Stage: Active Build")).toBeVisible();

  await clickAndSettle(page, habitRow.getByRole("button", { name: "Advance to Stabilized" }));
  await expect(habitRow.getByText("Stage: Stabilized")).toBeVisible();
  await expect(habitRow.getByText("(manually set)")).toBeVisible();

  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  // --- The assertion that matters: it renders where the override says ---
  const stabilizedColumn = habitPanel.locator("h3", { hasText: "Stabilized" }).locator("xpath=following-sibling::ul[1]");
  await expect(stabilizedColumn.getByText(habitName)).toBeVisible();
  await expect(activeBuildColumn.getByText(habitName)).toHaveCount(0);

  // Persists across a real reload, not just client-side state.
  await page.reload();
  await dismissCheckinDialogIfPresent(page);
  const reloadedPanel = page.locator("[data-panel]").filter({ has: page.getByText("Habit Builder", { exact: true }) });
  const reloadedStabilized = reloadedPanel
    .locator("h3", { hasText: "Stabilized" })
    .locator("xpath=following-sibling::ul[1]");
  await expect(reloadedStabilized.getByText(habitName)).toBeVisible();

  // --- Reset to automatic, confirm it reverts to the derived stage ---
  await reloadedPanel.getByRole("button", { name: "Edit" }).click();
  const dialog2 = page.getByRole("dialog");
  const habitRow2 = dialog2.locator("li").filter({ hasText: habitName });
  await clickAndSettle(page, habitRow2.getByRole("button", { name: "Reset to automatic" }));
  await expect(habitRow2.getByText("Stage: Active Build")).toBeVisible();
  await expect(habitRow2.getByText("(manually set)")).toHaveCount(0);

  // --- Cleanup: remove the throwaway habit entirely ---
  await habitRow2.getByRole("button", { name: "Remove" }).click();
  await clickAndSettle(page, habitRow2.getByRole("button", { name: "Confirm remove" }));
  await expect(dialog2.getByText(habitName)).toHaveCount(0);

  await dialog2.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(habitPanel.getByText(habitName)).toHaveCount(0);
});
