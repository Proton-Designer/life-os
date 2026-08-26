import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent, clickAndSettle } from "./helpers";

// Covers the 2026-08-25 Daily Log redesign end to end: A1 ("tapping an
// exercise opens a popup right away," Ayman) and A2 (the daily-check
// zero-feedback bug — "you have to tap it multiple times").
//
// SCOPE NOTE on A1: SEED has no active workout plan seeded (Workout Plan:
// "none selected"), so no micro-exercise row exists to tap. Rather than
// seed a throwaway plan through the app (real residue risk in a table set
// already fragile enough that fitness-residue's own diagnostic route
// exists), this exercises the body_metric archetype instead — "Log
// today's weight." components/fitness/daily-log-list.tsx wraps every
// archetype except `session` in the exact same generic Dialog (only the
// inner form differs: RepsQuickEntry vs BodyMetricQuickEntry vs
// BenchmarkForm) — the popup-opens-instantly behavior under test here is
// archetype-agnostic, so body_metric is a faithful stand-in for "tapping
// an exercise," not a narrower claim wearing a wider one's label.
//
// PRE-RUN STATE MATTERS, same trap as e2e/deen.spec.ts: both the
// daily_check and body_metric rows this spec touches only render as
// PENDING (daily-log.ts's pendingDailyLog filters out anything already
// done) — a prior run's residue left uncleaned would make this spec's
// very first assertion (the row is visible) fail in a way that looks like
// a product regression. Both are cleared defensively BEFORE asserting
// anything, not just after, and again in an `afterEach` so a mid-test
// failure still leaves SEED clean.

test.describe("Fitness Daily Log — popup logging and one-tap feedback", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const secret = process.env.E2E_TEST_SECRET;
    test.skip(!secret, "E2E_TEST_SECRET not set — see .env.local");

    await page.request.delete(`${baseURL}/api/test/clear-daily-check`, {
      headers: { "x-e2e-secret": secret! },
      data: { kind: "protein" },
    });
    await page.request.delete(`${baseURL}/api/test/clear-body-metric`, {
      headers: { "x-e2e-secret": secret! },
      data: { field: "weight_lb" },
    });
  });

  test.afterEach(async ({ page, baseURL }) => {
    const secret = process.env.E2E_TEST_SECRET;
    if (!secret) return;
    await page.request.delete(`${baseURL}/api/test/clear-daily-check`, {
      headers: { "x-e2e-secret": secret },
      data: { kind: "protein" },
    });
    await page.request.delete(`${baseURL}/api/test/clear-body-metric`, {
      headers: { "x-e2e-secret": secret },
      data: { field: "weight_lb" },
    });
  });

  test("A1: tapping the weight row opens a popup immediately, focused, and logging from it persists", async ({
    page,
  }) => {
    await page.goto("/fitness");
    await dismissCheckinDialogIfPresent(page);

    const dailyLog = page.getByTestId("daily-log-list");
    const weightRow = dailyLog.getByRole("button", { name: "Log today's weight" });
    await expect(weightRow).toBeVisible();

    // No inline box below the row before the tap.
    await expect(page.getByRole("spinbutton", { name: "Weight (lb)" })).toHaveCount(0);

    await weightRow.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole("spinbutton", { name: "Weight (lb)" });
    await expect(input).toBeFocused();

    await input.fill("182");
    await clickAndSettle(page, dialog.getByRole("button", { name: "Save" }));
    await expect(dialog).toBeHidden();

    // The row is gone — dueToday flips false once today's weight is logged.
    await expect(dailyLog.getByRole("button", { name: "Log today's weight" })).toHaveCount(0);

    // Persists across a real reload, not just client-side optimism.
    await page.reload();
    await dismissCheckinDialogIfPresent(page);
    await expect(page.getByTestId("daily-log-list").getByRole("button", { name: "Log today's weight" })).toHaveCount(
      0
    );
  });

  test("A1: Enter in the popup's input submits, same as pressing the button", async ({ page }) => {
    await page.goto("/fitness");
    await dismissCheckinDialogIfPresent(page);

    await page.getByTestId("daily-log-list").getByRole("button", { name: "Log today's weight" }).click();
    const dialog = page.getByRole("dialog");
    const input = dialog.getByRole("spinbutton", { name: "Weight (lb)" });
    await input.fill("179");
    await input.press("Enter");
    await page.waitForLoadState("networkidle");

    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("daily-log-list").getByRole("button", { name: "Log today's weight" })).toHaveCount(
      0
    );
  });

  test("A2: a single tap on 'Hit protein target' shows a visible checked state immediately", async ({ page }) => {
    await page.goto("/fitness");
    await dismissCheckinDialogIfPresent(page);

    const proteinRow = page.getByTestId("daily-log-check-protein");
    await expect(proteinRow).toBeVisible();
    await expect(page.getByText("Hit protein target")).not.toHaveClass(/line-through/);

    // A single click — not two, not "click in a specific spot." The whole
    // point of this spec is that ONE tap is enough.
    await proteinRow.click();

    // Instant, optimistic: visibly checked before the row disappears.
    await expect(page.getByText("Hit protein target")).toHaveClass(/line-through/);

    // Wait for the real write to settle, then confirm the row actually
    // left the pending list (server-confirmed, not just an optimistic
    // paint that could still revert).
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("daily-log-check-protein")).toHaveCount(0);

    // Persists across a real reload.
    await page.reload();
    await dismissCheckinDialogIfPresent(page);
    await expect(page.getByTestId("daily-log-check-protein")).toHaveCount(0);
  });
});
