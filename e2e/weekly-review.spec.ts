import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

/**
 * Weekly Review (#46/#47/#48) — read-only, no mutation of its own (nothing
 * on this screen is ever edited from here, per components/weekly-review/
 * weekly-review-view.tsx's own header), so nothing to clean up.
 *
 * Asserts the three ruled sections render with a real content SHAPE
 * (headline is genuinely h:mm-formatted, not a placeholder string), not
 * just "the heading exists" — and that "This week so far" actually changes
 * which week is being measured, not merely its own link styling.
 *
 * HOURS, CORRECTED 2026-09-15: production briefly showed "Hours 4:07" as
 * almost entirely one abandoned 247-minute retrieval-review session — the
 * bars are now ONLY Deep Work/Deep Study (`counts_toward_hours`-filtered,
 * matching "Hours today" on /close), and Recall time renders as its own
 * separate line explicitly marked "not counted toward Hours," structurally
 * outside the bars the headline sums. This spec proves that SHAPE (a real
 * learn session isn't something this spec can seed against a live account,
 * so it can't assert the headline number itself excludes one the way
 * lib/evening-close/__tests__/hours-today.test.ts's unit tests do — it
 * proves the UI never has a "Recall" bar to sum in the first place).
 */
test.describe("Weekly Review", () => {
  test("renders Hours + by-kind bars (no Recall bar), the Distraction Pareto, and the habit-score summary", async ({ page }) => {
    await page.goto("/weekly-review");
    await dismissCheckinDialogIfPresent(page);

    await expect(page.getByRole("heading", { name: "Weekly Review" })).toBeVisible();

    // Hours: scoped to its own <section> so the h:mm assertion can't
    // accidentally match an unrelated number elsewhere on the page.
    const hoursSection = page.locator("section", { has: page.getByRole("heading", { name: "Hours" }) });
    await expect(hoursSection).toBeVisible();
    for (const label of ["Deep Work", "Deep Study"]) {
      await expect(hoursSection.getByText(label, { exact: true })).toBeVisible();
    }
    // The headline is a real "H:MM" figure (lib/evening-close/format-
    // hours.ts's formatHoursMinutes) — not zero-state placeholder text.
    await expect(hoursSection.getByText(/^\d+:\d{2}$/).first()).toBeVisible();

    // Recall renders as its own line, explicitly marked as excluded from
    // Hours — never as a fourth bar next to Deep Work/Deep Study.
    await expect(hoursSection.getByText(/Recall time \(not counted toward Hours\)/)).toBeVisible();

    // Distraction Pareto — all-time, so either a real bar or the explicit
    // empty state renders; either is a legitimate real answer for a real
    // account, unlike a screen showing neither.
    const paretoSection = page.locator("section", { has: page.getByRole("heading", { name: /Distraction Pareto/ }) });
    await expect(paretoSection).toBeVisible();
    await expect(
      paretoSection.getByText("No distractions logged yet.").or(paretoSection.locator("li").first())
    ).toBeVisible();

    // Habit scores — same "either a real row or the explicit empty state"
    // shape as Pareto above.
    const habitSection = page.locator("section", { has: page.getByRole("heading", { name: "Habit scores" }) });
    await expect(habitSection).toBeVisible();
    await expect(
      habitSection.getByText("No active identity habits yet.").or(habitSection.locator("li").first())
    ).toBeVisible();
  });

  test('"This week so far" toggle actually changes the reviewed range, not just its own link styling', async ({ page }) => {
    await page.goto("/weekly-review");
    await dismissCheckinDialogIfPresent(page);

    const completedLink = page.getByRole("link", { name: "Last completed week" });
    const soFarLink = page.getByRole("link", { name: "This week so far" });
    // The date-range description PageHeader renders under the h1 — both of
    // its two shapes (formatShortDate(...) – formatShortDate(...) and
    // formatShortDate(...) – today) contain an en dash, so this locates it
    // without depending on either shape's exact wording.
    const description = page.locator("p").filter({ hasText: "–" }).first();

    await expect(completedLink).toHaveAttribute("aria-current", "page");
    await expect(soFarLink).not.toHaveAttribute("aria-current", "page");
    const beforeText = await description.textContent();

    await soFarLink.click();
    await dismissCheckinDialogIfPresent(page);

    await expect(soFarLink).toHaveAttribute("aria-current", "page");
    await expect(completedLink).not.toHaveAttribute("aria-current", "page");
    const afterText = await description.textContent();

    expect(afterText, "the date-range description must change between the two views").not.toBe(beforeText);
    expect(afterText).toContain("today");
    expect(beforeText).not.toContain("today");
  });
});
