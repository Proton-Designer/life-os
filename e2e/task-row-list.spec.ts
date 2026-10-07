import { test, expect, type APIRequestContext } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

// Exercises the shared TaskRowList component (2026-08-25 tap-to-complete
// redesign) end to end: instant tap-anywhere completion on Home's Today
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
// tasks, and neither Home's Today panel nor School's KPI dialogs wire
// TaskRowList's onRemove — so once this spec completes the task (which it
// must, to test persistence-across-reload), there is no in-app path left to
// remove or revert it. Same "no UI affordance to undo this" shape as
// clear-prayer/clear-sunnah/clear-distraction-trigger.

// Home's Today panel lists every task for today (it used to show only the MOST URGENT pending item per domain), but a
// "Playwright tap-to-complete" task left behind by an earlier failed run (this spec cannot delete through the UI) is still
// an extra row that muddies the Completed section (E2E-01). Clear any residue before AND after each run.
const TITLE_PREFIX = "Playwright tap-to-complete ";

async function clearResidue(request: APIRequestContext, baseURL: string | undefined) {
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) return;
  await request
    .delete(`${baseURL}/api/test/clear-task`, { headers: { "x-e2e-secret": secret }, data: { titlePrefix: TITLE_PREFIX } })
    .catch(() => undefined);
}

test.beforeEach(async ({ request, baseURL }) => clearResidue(request, baseURL));
test.afterEach(async ({ request, baseURL }) => clearResidue(request, baseURL));

test.describe("TaskRowList — tap to complete", () => {
  test("completing a task on Home's Today panel is instant, moves it into the collapsed Completed section, and persists across reload", async ({
    page,
    baseURL,
  }) => {
    const secret = process.env.E2E_TEST_SECRET;
    if (!secret) test.skip(true, "E2E_TEST_SECRET not set — see .env.local");

    const taskTitle = `${TITLE_PREFIX}${Date.now()}`;

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

    // --- Complete it via Home's Today panel, whole-row tap ---
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);

    const nowPanel = page.locator("[data-panel]").filter({ has: page.getByText("Today", { exact: true }) }).filter({ has: page.getByTestId("today-tasks") });
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
    // PERF-1 (d540e34) moves the row after the 550 ms animation, NOT when the server confirms, so
    // "row hidden" no longer means "saved": the Server Action may still be queued/in flight (Server
    // Actions run one at a time, behind the topbar's polling actions) and a reload right now can
    // abort it. Give it a bounded chance to settle (idle is best-effort -- Home has background
    // polling/prefetch), then re-check across reloads until the server shows the completion.
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    await expect(async () => {
      await page.reload();
      await dismissCheckinDialogIfPresent(page);
      const nowPanelAfterReload = page.locator("[data-panel]").filter({ has: page.getByText("Today", { exact: true }) }).filter({ has: page.getByTestId("today-tasks") });
      await nowPanelAfterReload.getByRole("button", { name: "Completed" }).click({ timeout: 4_000 });
      await expect(nowPanelAfterReload.getByText(taskTitle)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 25_000 });

    // --- Cleanup: no UI path removes a completed task (see file comment) ---
    const cleanup = await page.request.delete(`${baseURL}/api/test/clear-task`, {
      headers: { "x-e2e-secret": secret! },
      data: { title: taskTitle },
    });
    expect(cleanup.ok()).toBe(true);
  });
});
