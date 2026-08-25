import { test, expect, type Page } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The account's own "today" (SEED's profile timezone) is not necessarily
// the test runner machine's UTC day — using `new Date().toISOString()` to
// pick "today" for a due-date field is exactly the class of bug this
// whole feature fixed elsewhere (get-home-extras.ts, tonight's prayer-
// window fix). Read it from the topbar's own dateLabel (e.g. "Mon, Aug
// 24") instead, which is computed server-side from the real profile
// timezone via formatTopbarDate.
async function todaysDateString(page: Page): Promise<string> {
  const label = await page.locator("header").getByText(/^\w{3}, \w{3} \d{1,2}$/).textContent();
  if (!label) throw new Error("Could not read the topbar date label");
  const match = label.match(/(\w{3}) (\d{1,2})/);
  if (!match) throw new Error(`Unrecognized topbar date label: "${label}"`);
  const [, monthName, day] = match;
  const monthIndex = MONTHS.indexOf(monthName);
  if (monthIndex === -1) throw new Error(`Unrecognized month in topbar date label: "${label}"`);
  const year = new Date().getFullYear();
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// Exercises the shared TaskRowList component (2026-08-25 tap-to-complete
// redesign) end to end: instant tap-anywhere completion on Home's Now
// module, the collapsed-by-default Completed section, and persistence
// across a reload. Uses School's task-add form to create a fresh, isolated
// pending item (its own client wrapper, components/school/task-panel.tsx,
// is a real TaskRowList caller) rather than relying on whatever the SEED
// account's existing state happens to be — Home's Now module only ever
// shows the SINGLE next item per domain, so pre-existing completed rows
// from other tests can't be relied on to still be pending.
//
// Cleans up the task it creates via TaskRowList's own Remove control on
// /school, so this spec is safe to re-run and doesn't accumulate SEED
// clutter run over run.

test.describe("TaskRowList — tap to complete", () => {
  test("completing a task on Home's Now module is instant, moves it into the collapsed Completed section, and persists across reload", async ({
    page,
  }) => {
    const taskTitle = `Playwright tap-to-complete ${Date.now()}`;

    // --- Create a fresh pending task due today, via School's add form ---
    await page.goto("/school");
    await dismissCheckinDialogIfPresent(page);
    const todayStr = await todaysDateString(page);
    const taskPanel = page.locator("#tasks");
    await taskPanel.getByPlaceholder("Add a task").fill(taskTitle);
    // School's add form has no default due date — set it explicitly to
    // today, per the account's OWN local day (not the test runner's).
    await taskPanel.locator('input[type="date"]').fill(todayStr);
    await taskPanel.getByRole("button", { name: "Add" }).click();
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

    // --- Cleanup: remove the test task via School's Remove control ---
    await page.goto("/school");
    await dismissCheckinDialogIfPresent(page);
    const schoolCompletedToggle = page.getByRole("button", { name: "Completed" });
    if (await schoolCompletedToggle.isVisible().catch(() => false)) {
      await schoolCompletedToggle.click();
    }
    await page.getByRole("button", { name: `Remove ${taskTitle}` }).click();
    await expect(page.getByText(taskTitle)).toBeHidden();
  });
});
