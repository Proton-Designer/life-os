import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

// Exercises the shared TaskRowList component (2026-08-25 tap-to-complete
// redesign) end to end: instant tap-anywhere completion on Home's Now
// module, the collapsed-by-default Completed section, and persistence
// across a reload.
//
// Creates and removes its task through School's current task flow
// (2026-08-26 afternoon batch: TaskWizardDialog + TaskListModule +
// TaskEditDialog replaced the old task-panel.tsx add form this spec
// originally drove — that component is deleted). Uses the wizard's "Today"
// quick-pick chip rather than typing a date, so the due date is computed
// through the account's own local timezone (the wizard's own
// `localDateString` call) instead of this spec re-deriving "today" itself —
// the class of bug this app has shipped from raw-Date day math before.
//
// Cleans up the task it creates via the test-only clear-task route
// (app/api/test/clear-task), not through the UI: the current redesign scopes
// both TaskListModule and TaskEditDialog on /school to open (not completed)
// tasks, and neither Home's Now module nor School's KPI dialogs wire
// TaskRowList's onRemove — so once this spec completes the task (which it
// must, to test persistence-across-reload), there is no in-app path left to
// remove or revert it. Same "no UI affordance to undo this" shape as
// clear-prayer/clear-sunnah/clear-distraction-trigger.

test.describe("TaskRowList — tap to complete", () => {
  test("completing a task on Home's Now module is instant, moves it into the collapsed Completed section, and persists across reload", async ({
    page,
    baseURL,
  }) => {
    const secret = process.env.E2E_TEST_SECRET;
    if (!secret) test.skip(true, "E2E_TEST_SECRET not set — see .env.local");

    const taskTitle = `Playwright tap-to-complete ${Date.now()}`;

    // --- Create a fresh pending task due today, via School's task wizard ---
    await page.goto("/school");
    await dismissCheckinDialogIfPresent(page);
    const taskPanel = page.locator("#tasks");
    await taskPanel.getByRole("button", { name: "Add" }).click();

    await page.getByRole("dialog", { name: "Which class?" }).getByRole("button", { name: "Generic" }).click();
    await page
      .getByRole("dialog", { name: "What type of task?" })
      .getByRole("button", { name: "Homework/Assignment" })
      .click();
    const describeDialog = page.getByRole("dialog", { name: "Describe the task" });
    await describeDialog.getByPlaceholder("Description").fill(taskTitle);
    await describeDialog.getByRole("button", { name: "Today" }).click();
    await describeDialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(taskPanel.getByText(taskTitle)).toBeVisible();

    // --- Complete it via Home's Now module, whole-row tap ---
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);

    const nowPanel = page.locator("[data-panel]").filter({ has: page.getByText("Now", { exact: true }) });
    const row = nowPanel.getByRole("button", { name: `Mark "${taskTitle}" done` });
    await expect(row).toBeVisible();

    await row.click();

    // Instant response: still on screen, but visually marked done (checkbox
    // filled + strikethrough) — not waiting on a server round trip.
    await expect(nowPanel.getByText(taskTitle)).toHaveClass(/line-through/);

    // After the confirm beat, it leaves the active list and the Completed
    // section appears, collapsed by default (only the label shows).
    await expect(row).toBeHidden({ timeout: 3000 });
    const completedToggle = nowPanel.getByRole("button", { name: "Completed" });
    await expect(completedToggle).toBeVisible();
    await expect(nowPanel.getByText(taskTitle)).toBeHidden();

    // Expanding it shows the completed task.
    await completedToggle.click();
    await expect(nowPanel.getByText(taskTitle)).toBeVisible();

    // --- Persists across a real reload (not just client-side optimism) ---
    await page.reload();
    await dismissCheckinDialogIfPresent(page);
    const nowPanelAfterReload = page.locator("[data-panel]").filter({ has: page.getByText("Now", { exact: true }) });
    await nowPanelAfterReload.getByRole("button", { name: "Completed" }).click();
    await expect(nowPanelAfterReload.getByText(taskTitle)).toBeVisible();

    // --- Cleanup: no UI path removes a completed task (see file comment) ---
    const cleanup = await page.request.delete(`${baseURL}/api/test/clear-task`, {
      headers: { "x-e2e-secret": secret! },
      data: { title: taskTitle },
    });
    expect(cleanup.ok()).toBe(true);
  });
});
