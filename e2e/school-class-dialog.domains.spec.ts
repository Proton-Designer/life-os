import { test, expect, type Page } from "@playwright/test";

/**
 * The School class-detail dialog, measured against a fixture that actually has
 * assessments in it.
 *
 * WHY THIS SPEC EXISTS SEPARATELY FROM layout-overflow.spec.ts:
 *
 * That suite runs as SEED, which has 6 classes and ZERO `class_assessments`.
 * Its class-view dialog test has therefore been measuring an EMPTY assessments
 * table — passing cleanly, for a week, over the exact surface a real defect was
 * living on. AGENTS.md already records this once: "an overlap check measured an
 * assessments table that was empty on SEED — zero overlaps found, because there
 * was nothing to overlap." The fixture was never fixed, so the same emptiness
 * hid the crushed Name column found on 2026-09-02 (box 56px, needs 229px — the
 * identical string rendering in full 400px lower in the same dialog).
 *
 * So this runs as the R41 domains fixture, which carries realistic assessment
 * titles, and it REFUSES TO MEASURE ANYTHING until it has confirmed the rows
 * are present. A layout assertion over an empty table is not a weak test; it is
 * a test of nothing that reports success, which is worse than no test at all
 * because it occupies the slot where a real one would go.
 */

const BREAKPOINTS = [320, 390, 768, 1024];

/**
 * The content precondition. Deliberately an assertion and not a skip: if the
 * fixture loses its assessments, this spec must go RED and say so, not quietly
 * pass or silently opt out. A skip here would recreate the exact hole it exists
 * to close.
 */
async function openClassDialogWithAssessments(page: Page) {
  await page.goto("/school");
  await page.waitForLoadState("networkidle");

  const card = page
    .locator("div")
    .filter({ hasText: /Organic Chemistry II/ })
    .filter({ has: page.getByRole("button", { name: "View" }) })
    .last();
  await card.getByRole("button", { name: "View" }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // READY_SELECTOR discipline: a content assertion, not a timing settle. A
  // networkidle+rAF settle cannot tell "the rows have not mounted yet" apart
  // from "there are no rows" — only naming the content can.
  await expect(
    dialog.getByText("Midterm Exam 2 — Stereochemistry").first(),
    "domains fixture has lost its class_assessments — this spec measures nothing without them"
  ).toBeVisible({ timeout: 15_000 });

  return dialog;
}

/**
 * Crushed text: an element showing less than half its content. Distinct from
 * overflow — a clipped cell overflows nothing, which is why the document-level
 * and [data-panel] checks in layout-overflow.spec.ts both pass straight
 * through this class of defect, and why a column-overlap check does too (the
 * columns never intersect; one is simply too narrow).
 */
async function assertNoCrushedText(page: Page, width: number) {
  const crushed = await page.evaluate(() => {
    const root = document.querySelector('[role="dialog"]');
    if (!root) return [{ text: "NO DIALOG", box: 0, needs: 0 }];
    const out: { text: string; box: number; needs: number }[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
      if (el.children.length > 0) continue;
      const text = (el.textContent ?? "").trim();
      if (text.length < 8) continue;
      const box = el.clientWidth;
      const needs = el.scrollWidth;
      if (box > 0 && needs > box * 2) out.push({ text: text.slice(0, 40), box, needs });
    }
    return out;
  });

  expect(crushed, `text crushed to under half its width at ${width}px: ${JSON.stringify(crushed)}`).toEqual([]);
}

test.describe("School class dialog, against a fixture with real assessments", () => {
  test("assessment titles are never crushed at any breakpoint", async ({ page }) => {
    for (const width of BREAKPOINTS) {
      await page.setViewportSize({ width, height: 900 });
      await openClassDialogWithAssessments(page);
      await assertNoCrushedText(page, width);
    }
  });

  /**
   * The control that makes the assertion above mean something. The same title
   * renders in two places in this dialog — the assessments list and the grade
   * ledger. When the bug was live, one was 56px and the other 229px for
   * identical text. Asserting they BOTH fit is stronger than asserting a
   * number, because it cannot be satisfied by a layout that simply got
   * narrower everywhere.
   */
  test("the same title fits in both the assessments list and the grade ledger", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const dialog = await openClassDialogWithAssessments(page);
    await expect(dialog.getByText("Grade")).toBeVisible();

    const boxes = await page.evaluate(() => {
      const root = document.querySelector('[role="dialog"]')!;
      return Array.from(root.querySelectorAll<HTMLElement>("*"))
        .filter((el) => el.children.length === 0 && (el.textContent ?? "").trim().startsWith("Midterm Exam 2"))
        .map((el) => ({ box: el.clientWidth, needs: el.scrollWidth }));
    });

    expect(boxes.length, "expected the title in both the assessments list and the grade ledger").toBeGreaterThanOrEqual(2);
    for (const b of boxes) {
      expect(b.box, `title clipped: ${b.box}px box for ${b.needs}px of text`).toBeGreaterThanOrEqual(b.needs);
    }
  });

  test("the dialog does not scroll the page horizontally at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openClassDialogWithAssessments(page);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
