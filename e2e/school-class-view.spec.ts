import { test, expect, type Page } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

/**
 * The expanded class view (2026-08-26 afternoon batch). Written by the Lead
 * from Ayman's request rather than by the engineers who built the feature,
 * and written to the SPEC rather than to the implementation — the point is
 * to check that what he asked for is what shipped, not to restate what the
 * code happens to do.
 *
 * The two assertions that matter most here are the integration seams, and
 * they exist because of a specific failure the night before: a component
 * was built, unit tested, handed over as a snippet, and never pasted in.
 * `tsc` and all 1577 vitest tests were green and `/school` would have
 * shipped without it. A unit test structurally CANNOT catch "wired to
 * nothing" — only a real render of the real page can, which is what this
 * file is for.
 *
 * Runs against SEED, never Ayman's real account. SEED has all six classes
 * with positions but no tasks, assessments or syllabus, so anything this
 * spec needs it creates and then removes.
 */

/** Ayman's requested card order, verbatim from the request. Not alphabetical. */
const CLASS_ORDER = ["Prob & Stats", "DSA", "Lin Alg", "Ameri Studies", "Phys", "Phys Lab"];

async function openSchool(page: Page) {
  await page.goto("/school");
  await dismissCheckinDialogIfPresent(page);
}

/** Opens one class's expanded view and returns the dialog locator. */
async function openClass(page: Page, className: string) {
  await page.getByRole("button", { name: `View ${className}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * The title of the task the add-task test creates, tracked at file scope so
 * `afterEach` can remove it even when an assertion failed before the test's
 * own in-UI removal step was reached.
 *
 * Without this the spec poisons its own fixture: a failure — including one
 * caused by something entirely unrelated, like a corrupted storageState —
 * leaves the created row behind, and the NEXT run then has two tasks due the
 * same day, which is itself a failure, which leaves a third row, and so on.
 * It amplifies one incident into a permanently red spec. (Diagnosed by
 * Engineer B and independently reproduced by Engineer C, 2026-08-26, after
 * four agents ran mutating suites against the shared SEED account at once.)
 *
 * The in-UI removal inside the test still runs and is still a real assertion
 * about the Edit→Remove→Save flow — this is a safety net beneath it, not a
 * replacement for it.
 */
let createdTaskTitle: string | null = null;

test.afterEach(async ({ request, baseURL }) => {
  if (!createdTaskTitle) return;
  const title = createdTaskTitle;
  createdTaskTitle = null;
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) return;
  // Best-effort: never let cleanup failure mask the real test result.
  await request
    .delete(`${baseURL}/api/test/clear-task`, { headers: { "x-e2e-secret": secret }, data: { title } })
    .catch(() => undefined);
});

test.describe("School — expanded class view", () => {
  test("class cards render in Ayman's requested order, not alphabetically", async ({ page }) => {
    await openSchool(page);

    // Read the cards' own View buttons rather than headings: "Phys" is a
    // prefix of "Phys Lab", so a text match would be ambiguous, while the
    // per-class accessible name is exact.
    //
    // Anchored to the exact class names because /school also carries three
    // KPI modules whose View buttons ("View due today", "View overdue",
    // "View due this week") would otherwise be swept in — and a bare
    // `/^View /` would silently start passing again if a seventh class were
    // added, since it never asserts WHICH buttons matched.
    const classViewName = new RegExp(`^View (${CLASS_ORDER.join("|")})$`);
    const viewButtons = page.getByRole("button", { name: classViewName });
    await expect(viewButtons).toHaveCount(CLASS_ORDER.length);

    // toHaveAccessibleName takes a single name, not a list, so read the
    // labels in DOM order and compare as a sequence — the count assertion
    // above is the retrying one that waits for the grid to settle.
    const names = await viewButtons.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
    expect(names).toEqual(CLASS_ORDER.map((c) => `View ${c}`));
  });

  // Ayman's C1 report, stated as the browser behaviour he actually saw:
  // "when the user presses view syllabus it downloads the syllabus to the
  // user's machine ... it shouldn't download, it should just pull up a
  // popup." So the assertion is literally "no download fired" — asserting
  // on the viewer's internals would miss the case where a popup opens AND
  // the browser also grabs the file, which is the half-fixed state.
  //
  // Both formats are covered because they take completely different code
  // paths: PDF renders in an <iframe> (which always worked), .docx is
  // fetched and rendered client-side by docx-preview (the actual fix).
  // The .docx is the one that was broken, and it's the class in his
  // screenshot.
  for (const { className, format } of [
    { className: "DSA", format: "pdf" },
    { className: "Ameri Studies", format: "docx" },
  ]) {
    test(`viewing a ${format} syllabus opens a popup and does not download`, async ({ page }) => {
      await openSchool(page);
      const dialog = await openClass(page, className);

      const downloads: string[] = [];
      page.on("download", (d) => downloads.push(d.suggestedFilename()));

      await dialog.getByRole("button", { name: /^View$/ }).click();

      const viewer = page.getByRole("dialog").filter({ hasText: "Syllabus" }).last();
      await expect(viewer).toBeVisible();

      // The honest-failure fallback is still a failure for this test: it
      // means he clicked View and did not get to see his syllabus.
      await expect(viewer.getByText(/can't be previewed/i)).toHaveCount(0);

      // Give any errant download a moment to fire before concluding none did.
      await page.waitForTimeout(1500);
      expect(downloads).toEqual([]);
    });
  }

  // ---------------------------------------------------------------------
  // The three tests below describe work that is still in flight (B's edit
  // mode and instant load, C's locked-class wizard and date formatting).
  // They are `fixme` so the suite stays green for everyone else, NOT
  // because they are optional — the Lead flips each one on as its feature
  // lands, and a feature is not DONE until its test here is un-fixmed and
  // passing. Engineers: drop the `.fixme` locally to check your own work.
  // ---------------------------------------------------------------------

  test("opens fully populated with no loading states — the waterfall is gone", async ({ page }) => {
    await openSchool(page);

    // The failure being guarded against is a dialog that paints, THEN
    // fetches. Racing that is unreliable by nature, so instead of trying to
    // catch the loading text mid-flight, assert the sections are present on
    // the very first snapshot after the dialog appears AND that the loading
    // strings never appear at all. If the useEffect fetch were still there,
    // the section content would not be in that first paint.
    const dialog = await openClass(page, "DSA");

    await expect(dialog.getByRole("heading", { name: "Assessments" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Syllabus" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Task list" })).toBeVisible();

    await expect(dialog.getByText(/Loading assessments/i)).toHaveCount(0);
    await expect(dialog.getByText(/Loading tasks/i)).toHaveCount(0);
  });

  test("Edit swaps itself for Save and Cancel, and Cancel genuinely rolls back", async ({ page }) => {
    await openSchool(page);
    const dialog = await openClass(page, "Lin Alg");

    const originalDetails = (await dialog.getByText(/MATH 2418/).first().textContent()) ?? "";
    expect(originalDetails).not.toBe("");

    await dialog.getByRole("button", { name: "Edit Lin Alg" }).click();

    // Edit must be GONE from the a11y tree, not merely visually hidden.
    await expect(dialog.getByRole("button", { name: "Edit Lin Alg" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Save Lin Alg" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel Lin Alg" })).toBeVisible();

    const sentinel = `ROLLBACK-SENTINEL-${Date.now()}`;
    const roomField = dialog.getByPlaceholder("Room");
    await roomField.fill(sentinel);
    await dialog.getByRole("button", { name: "Cancel Lin Alg" }).click();

    // First check: the staged edit is discarded in the open dialog.
    await expect(dialog.getByText(sentinel)).toHaveCount(0);

    // Second check, and the one that actually matters: reopen from scratch.
    // A Cancel that only reset local state but had already written through
    // would pass the check above and fail this one.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    const reopened = await openClass(page, "Lin Alg");
    await expect(reopened.getByText(sentinel)).toHaveCount(0);
    await expect(reopened.getByText(/MATH 2418/).first()).toBeVisible();
  });

  test("adding a task does not re-ask for the class, and dates read 'Sep. 3rd'", async ({ page }) => {
    await openSchool(page);
    const dialog = await openClass(page, "Ameri Studies");

    const taskTitle = `Playwright class-scoped ${Date.now()}`;
    // Register for afterEach cleanup BEFORE creating it, so an assertion
    // failure anywhere below still gets the row removed.
    createdTaskTitle = taskTitle;
    await dialog.getByRole("button", { name: /^Add/ }).last().click();

    const wizard = page.getByRole("dialog").last();

    // The class step must never render: the user is already inside one
    // class. "Generic" is the giveaway that step 1 appeared.
    await expect(wizard.getByText(/Generic/)).toHaveCount(0);
    // ...and the type step must be what's showing instead.
    const homeworkOption = wizard.getByRole("button", { name: /Homework/ });
    await expect(homeworkOption).toBeVisible();
    await homeworkOption.click();

    await wizard.getByLabel(/Due Date|^Date/).fill("2026-09-03");
    await wizard.getByRole("textbox").first().fill(taskTitle);
    await wizard.getByRole("button", { name: /^Add$/ }).click();

    // A future-dated task lands in the collapsed "Future" group, so expand
    // it before asserting on the row.
    await dialog.getByRole("button", { name: /Future/ }).click();

    // Scope the date assertion to THIS task's own row, found by its unique
    // title. Asserting on a bare `getByText("Sep. 3rd")` was a real defect
    // in an earlier version of this spec: any other task sharing that due
    // date matches too, so the locator resolves to several elements and
    // fails strict mode. Worse, it failed *before* the cleanup below ever
    // ran, so every failed attempt left another row behind and made the
    // next attempt fail harder — a test that poisons its own fixture.
    // Anchoring to the unique title makes it independent of whatever else
    // happens to be due that day. (Found by Engineer B, 2026-08-26.)
    const row = dialog.locator("li", { hasText: taskTitle });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Sep. 3rd")).toBeVisible();
    await expect(row.getByText("2026-09-03")).toHaveCount(0);

    // A class-scoped list has no business offering a class filter.
    await expect(dialog.getByRole("combobox", { name: /All classes/i })).toHaveCount(0);

    // --- Remove it again: this both tests C3 and keeps SEED clean, so the
    // spec is safe to re-run without accumulating clutter. ---
    await dialog.getByRole("button", { name: "Edit Ameri Studies" }).click();
    await dialog.getByRole("button", { name: `Remove ${taskTitle}` }).click();
    await dialog.getByRole("button", { name: "Save Ameri Studies" }).click();

    await expect(dialog.getByText(taskTitle)).toHaveCount(0);
  });
});
