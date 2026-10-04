import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

// IA-P3a: the weekly reset replaces four nav screens. The old URLs stay as redirects.
test.describe("Weekly reset (/week)", () => {
  test("shows the five steps in order", async ({ page }) => {
    await page.goto("/week");
    await dismissCheckinDialogIfPresent(page);
    await expect(page.getByRole("heading", { name: "Weekly reset" })).toBeVisible();
    for (const title of [/^1 · Look back/, /^2 · Goals/, /^3 · Habits/, /^4 · Worry hour/, /^5 · This week/]) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }
  });

  for (const [from, hash] of [
    ["/goals", "goals"],
    ["/habits", "habits"],
    ["/worries", "worries"],
  ] as const) {
    test(`${from} redirects to the ${hash} step`, async ({ page }) => {
      await page.goto(from);
      await expect(page).toHaveURL(new RegExp(`/week(#${hash})?$`));
      await expect(page.locator(`#${hash}`)).toBeVisible();
    });
  }

  test("/weekly-review lands on the reset (Sun–Mon noon) or the Insights Week tab", async ({ page }) => {
    await page.goto("/weekly-review");
    await expect(page).toHaveURL(/\/week$|\/insights\?tab=week$/);
  });

  test("the Insights Weekly review tab offers 'Start weekly reset' any day", async ({ page }) => {
    await page.goto("/insights?tab=week");
    await dismissCheckinDialogIfPresent(page);
    await page.getByRole("link", { name: "Start weekly reset" }).click();
    await expect(page).toHaveURL(/\/week$/);
  });
});
