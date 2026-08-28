import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent, clickAndSettle } from "./helpers";

// Originally covered A1 (Daily Log's popup logging) and A2 (Daily Log's
// one-tap daily-check feedback) from the 2026-08-25 batch. Batch 2, item 3
// (2026-08-25/26) removed BOTH archetypes from the Daily Log entirely —
// Ayman: "remove the Hit protein target and 8k+ steps and log today's
// weight and log waist things from the daily log, only keep log waist and
// log weight but keep them in the cycle progress checks sections and dont
// turn them into daily tasks."
//
// A2 has no surviving affordance anywhere — there is nothing left to test.
// A1's popup-on-tap pattern survives, just relocated: BodyModule (Cycle
// Progress checks) now owns weight/waist logging via the same instant-open,
// focused-input, Enter-submits Dialog pattern, but explicitly WITHOUT task
// semantics — logging must not remove the button or gate it behind a
// "due" state, since it's available on demand, not once a day.
test.describe("Fitness — weight/waist logging in Cycle Progress checks (relocated from Daily Log)", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const secret = process.env.E2E_TEST_SECRET;
    test.skip(!secret, "E2E_TEST_SECRET not set — see .env.local");

    await page.request.delete(`${baseURL}/api/test/clear-body-metric`, {
      headers: { "x-e2e-secret": secret! },
      data: { field: "weight_lb" },
    });
  });

  test.afterEach(async ({ page, baseURL }) => {
    const secret = process.env.E2E_TEST_SECRET;
    if (!secret) return;
    await page.request.delete(`${baseURL}/api/test/clear-body-metric`, {
      headers: { "x-e2e-secret": secret },
      data: { field: "weight_lb" },
    });
  });

  test("the Daily Log no longer shows protein/steps/weight/waist at all", async ({ page }) => {
    await page.goto("/fitness");
    await dismissCheckinDialogIfPresent(page);

    const dailyLog = page.getByTestId("daily-log-list");
    await expect(dailyLog.getByText("Hit protein target")).toHaveCount(0);
    await expect(dailyLog.getByText("8,000+ steps")).toHaveCount(0);
    await expect(dailyLog.getByText("Log today's weight")).toHaveCount(0);
    await expect(dailyLog.getByText("Log waist")).toHaveCount(0);
  });

  test("Weight's Log button in Cycle Progress checks opens a popup instantly, focused, and persists — without becoming a daily task", async ({
    page,
  }) => {
    await page.goto("/fitness");
    await dismissCheckinDialogIfPresent(page);

    const bodyModule = page.getByTestId("body-module");
    // .first() (auto-waiting) rather than a destructured .all() — .all() does
    // not wait, so once every route gained a loading.tsx boundary this
    // resolved to [] against the still-streaming skeleton and yielded
    // undefined. See settleRoute()'s note in helpers.ts.
    const weightLog = bodyModule.getByRole("button", { name: "Log" }).first();
    await expect(weightLog).toBeVisible();
    await weightLog.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Log today's weight");
    const input = dialog.getByRole("spinbutton", { name: "Weight (lb)" });
    await expect(input).toBeFocused();

    await input.fill("182");
    await clickAndSettle(page, dialog.getByRole("button", { name: "Save" }));
    await expect(dialog).toBeHidden();

    // NOT a daily task: the Log button is still there afterward, not
    // removed, not disabled — logging is on demand, no "due today" state.
    await expect(bodyModule.getByRole("button", { name: "Log" }).first()).toBeEnabled();
    await expect(bodyModule).toContainText("182 lb");

    // Persists across a real reload.
    await page.reload();
    await dismissCheckinDialogIfPresent(page);
    await expect(page.getByTestId("body-module")).toContainText("182 lb");
  });

  test("Enter in the popup's input submits, same as pressing Save", async ({ page }) => {
    await page.goto("/fitness");
    await dismissCheckinDialogIfPresent(page);

    const bodyModule = page.getByTestId("body-module");
    await bodyModule.getByRole("button", { name: "Log" }).first().click();
    const dialog = page.getByRole("dialog");
    const input = dialog.getByRole("spinbutton", { name: "Weight (lb)" });
    await input.fill("179");
    await input.press("Enter");
    await page.waitForLoadState("networkidle");

    await expect(dialog).toBeHidden();
    await expect(bodyModule).toContainText("179 lb");
  });
});
