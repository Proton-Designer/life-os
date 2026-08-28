import { test, expect, type Page, type Locator } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

/**
 * The Work-screen restructure (batch 5): the old separate "Weekly Agenda"
 * and "Pipeline" panels are gone, replaced by one panel titled "Weekly
 * Agenda Pipeline" with an "+ Add a task" control in its header and a
 * "Past" button on the Complete column that opens a dialog for tasks that
 * have sat completed for 7+ days (coop_tasks.completed_at, migration 055).
 *
 * Written to the AGREED CONTRACT ahead of the implementation landing
 * (Opus Lead, batch 5 dispatch) — genuinely parallel work, not
 * speculation. If this spec and the shipped build disagree, that
 * disagreement is the finding; the Lead reconciles it, not this file.
 *
 * Runs against SEED, never Ayman's real account. SEED carries no active
 * coop_targets row at position 1 by default — same as
 * e2e/realtime-sync.spec.ts's Work case — so every test in this file
 * establishes its own target via the test-only work-pipeline-target route
 * before the page loads, and tears it down in afterEach regardless of
 * pass/fail (coop_tasks cascades off coop_targets via
 * coop_tasks_target_id_fkey, so every task a test creates dies with its
 * target in one request — no per-task cleanup tracking needed).
 *
 * Does not touch app/(app)/work/**, components/co-op/**, or lib/coop/** —
 * those are usvggmr2's this round.
 */

async function openWork(page: Page) {
  await page.goto("/work");
  await dismissCheckinDialogIfPresent(page);
}

function pipelinePanel(page: Page): Locator {
  return page.locator("[data-panel]").filter({ hasText: "Weekly Agenda Pipeline" });
}

let targetId: string | null = null;

test.beforeEach(async ({ request, baseURL }) => {
  const secret = process.env.E2E_TEST_SECRET;
  test.skip(!secret, "E2E_TEST_SECRET not set — see .env.local");
  const res = await request.post(`${baseURL}/api/test/work-pipeline-target`, {
    headers: { "x-e2e-secret": secret! },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { targetId: string };
  targetId = body.targetId;
});

// Registered before any test creates a task under `targetId` — deleting
// the target cascades every task this file ever creates, so a failure
// mid-test still leaves SEED clean. Never let cleanup failure mask the
// real test result (best-effort, matches school-class-view.spec.ts).
test.afterEach(async ({ request, baseURL }) => {
  targetId = null;
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) return;
  await request
    .delete(`${baseURL}/api/test/work-pipeline-target`, { headers: { "x-e2e-secret": secret } })
    .catch(() => undefined);
});

async function addTaskFromPanel(page: Page, panel: Locator, title: string) {
  await panel.getByRole("button", { name: "+ Add a task", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await expect(dialog.getByText("Add a task", { exact: true })).toBeVisible();
  await dialog.getByPlaceholder("Task title").fill(title);
  await dialog.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function createCompletedTaskAt(
  page: Page,
  baseURL: string | undefined,
  title: string,
  daysAgo: number,
  hour: number,
  minute: number
) {
  const secret = process.env.E2E_TEST_SECRET!;
  const res = await page.request.post(`${baseURL}/api/test/coop-task-completed-at`, {
    headers: { "x-e2e-secret": secret },
    data: { targetId, title, daysAgo, hour, minute },
  });
  expect(res.ok()).toBe(true);
}

test.describe("Work — Weekly Agenda Pipeline", () => {
  test("adding a task from the merged panel's header places it in Backlog", async ({ page }) => {
    await openWork(page);
    const panel = pipelinePanel(page);
    await expect(panel).toBeVisible();

    // The old separate "Weekly Agenda" and "Pipeline" panels are gone —
    // /work renders exactly one Panel now, and it carries the merged title.
    await expect(page.locator("[data-panel]")).toHaveCount(1);

    const title = `Playwright pipeline add ${Date.now()}`;
    await addTaskFromPanel(page, panel, title);

    await expect(panel.getByText(title)).toBeVisible();
    await expect(panel.getByText("Backlog (1)", { exact: true })).toBeVisible();
  });

  test("Advance / Back / Block / Unblock move a card between columns", async ({ page }) => {
    await openWork(page);
    const panel = pipelinePanel(page);
    await expect(panel).toBeVisible();

    const title = `Playwright pipeline moves ${Date.now()}`;
    await addTaskFromPanel(page, panel, title);
    await expect(panel.getByText("Backlog (1)", { exact: true })).toBeVisible();

    // Advance: Backlog -> In Progress
    await panel.getByRole("button", { name: "Advance a stage" }).click();
    await expect(panel.getByText("In Progress (1)", { exact: true })).toBeVisible();
    await expect(panel.getByText("Backlog (0)", { exact: true })).toBeVisible();

    // Back: In Progress -> Backlog
    await panel.getByRole("button", { name: "Move back a stage" }).click();
    await expect(panel.getByText("Backlog (1)", { exact: true })).toBeVisible();
    await expect(panel.getByText("In Progress (0)", { exact: true })).toBeVisible();

    // Advance again so there's something to block from a non-default stage.
    await panel.getByRole("button", { name: "Advance a stage" }).click();
    await expect(panel.getByText("In Progress (1)", { exact: true })).toBeVisible();

    // Block: detaches from the column sequence into the Blocked section.
    await panel.getByRole("button", { name: /Mark blocked/ }).click();
    await expect(panel.getByText("In Progress (0)", { exact: true })).toBeVisible();
    await expect(panel.getByText("Blocked (1)", { exact: true })).toBeVisible();

    // Unblock: restores to blockedFrom (In Progress), not to Backlog.
    await panel.getByRole("button", { name: "Unblock", exact: true }).click();
    await expect(panel.getByText("In Progress (1)", { exact: true })).toBeVisible();
    await expect(panel.getByText("Blocked (0)", { exact: true })).toBeVisible();
  });

  test("a freshly-completed task lands in Complete, not Past", async ({ page }) => {
    await openWork(page);
    const panel = pipelinePanel(page);
    await expect(panel).toBeVisible();

    const title = `Playwright pipeline fresh-complete ${Date.now()}`;
    await addTaskFromPanel(page, panel, title);
    // Backlog -> In Progress -> Review -> Complete.
    await panel.getByRole("button", { name: "Advance a stage" }).click();
    await panel.getByRole("button", { name: "Advance a stage" }).click();
    await panel.getByRole("button", { name: "Advance a stage" }).click();

    await expect(panel.getByText("Complete (1)", { exact: true })).toBeVisible();
    await expect(panel.getByText(title)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Past (0)", exact: true })).toBeVisible();
  });

  // The important one (Lead's own framing): the 7-day boundary is a
  // CALENDAR-DATE computation in the account's own timezone, never a raw
  // hour/UTC-rollover count — the exact bug class AGENTS.md documents as
  // having shipped three times. Pinned from three angles: strictly before
  // the boundary (6 days), and both sides of local midnight exactly AT the
  // boundary (7 days ago at 18:59 and 19:01 local) — both of the latter
  // must classify identically, since isPastCompletedTask only ever compares
  // calendar-date strings, never clock time.
  test("a task completed >7 days ago lands in Past, not Complete — boundary pinned", async ({ page, baseURL }) => {
    const notYetTitle = `Playwright pipeline 6d ${Date.now()}`;
    const boundaryEarlyTitle = `Playwright pipeline 7d-1859 ${Date.now()}`;
    const boundaryLateTitle = `Playwright pipeline 7d-1901 ${Date.now()}`;

    await createCompletedTaskAt(page, baseURL, notYetTitle, 6, 12, 0);
    await createCompletedTaskAt(page, baseURL, boundaryEarlyTitle, 7, 18, 59);
    await createCompletedTaskAt(page, baseURL, boundaryLateTitle, 7, 19, 1);

    await openWork(page);
    const panel = pipelinePanel(page);
    await expect(panel).toBeVisible();

    // Strictly-before-the-boundary task stays in Complete.
    await expect(panel.getByText("Complete (1)", { exact: true })).toBeVisible();
    await expect(panel.getByText(notYetTitle)).toBeVisible();

    // Both at-the-boundary tasks classify identically — Past, not Complete —
    // regardless of which side of local midnight they were completed on.
    await expect(panel.getByRole("button", { name: "Past (2)", exact: true })).toBeVisible();
    await expect(panel.getByText(boundaryEarlyTitle)).toHaveCount(0);
    await expect(panel.getByText(boundaryLateTitle)).toHaveCount(0);

    await panel.getByRole("button", { name: "Past (2)", exact: true }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Past completed tasks" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(boundaryEarlyTitle)).toBeVisible();
    await expect(dialog.getByText(boundaryLateTitle)).toBeVisible();
    await expect(dialog.getByText(notYetTitle)).toHaveCount(0);
  });

  test("Return to Review from the Past dialog puts the task back in the Review column", async ({ page, baseURL }) => {
    const title = `Playwright pipeline return-to-review ${Date.now()}`;
    await createCompletedTaskAt(page, baseURL, title, 8, 12, 0);

    await openWork(page);
    const panel = pipelinePanel(page);
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Past (1)", exact: true }).click();

    const dialog = page.getByRole("dialog").filter({ hasText: "Past completed tasks" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: `Return "${title}" to Review` }).click();

    await expect(dialog.getByText(title)).toHaveCount(0, { timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await expect(panel.getByText("Review (1)", { exact: true })).toBeVisible();
    await expect(panel.getByText(title)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Past (0)", exact: true })).toBeVisible();
  });

  test("bulk delete removes only the selected rows — the rest survive", async ({ page, baseURL }) => {
    const keepTitle = `Playwright pipeline bulk-keep ${Date.now()}`;
    const deleteTitle = `Playwright pipeline bulk-delete ${Date.now()}`;
    await createCompletedTaskAt(page, baseURL, keepTitle, 8, 12, 0);
    await createCompletedTaskAt(page, baseURL, deleteTitle, 9, 12, 0);

    await openWork(page);
    const panel = pipelinePanel(page);
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Past (2)", exact: true }).click();

    const dialog = page.getByRole("dialog").filter({ hasText: "Past completed tasks" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(keepTitle)).toBeVisible();
    await expect(dialog.getByText(deleteTitle)).toBeVisible();

    // Select only the row meant to be deleted.
    await dialog.getByRole("checkbox", { name: `Select "${deleteTitle}"` }).check();
    await dialog.getByRole("button", { name: "Delete 1", exact: true }).click();

    const confirmDialog = page.getByRole("dialog").last();
    await expect(confirmDialog.getByText("Delete 1 tasks?", { exact: true })).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Delete 1", exact: true }).click();

    // The destructive assertion that actually matters: the NON-selected row
    // survives, not just that the selected one is gone. A bulk delete that
    // wiped everything would still pass a test that only checked the target.
    await expect(dialog.getByText(deleteTitle)).toHaveCount(0, { timeout: 10_000 });
    await expect(dialog.getByText(keepTitle)).toBeVisible();
  });
});
