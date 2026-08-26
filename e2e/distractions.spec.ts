import { test, expect, type Page } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";
import { isReviewOpen } from "@/lib/distractions/plan-rules";

// playwright.config.ts runs fully serial against ONE real live account with
// no per-test isolation (see fitness.spec.ts's header comment for the race
// that made that a hard rule). Everything this file creates is prefixed
// "E2E-DIST " so it's identifiable if a run is interrupted mid-test, and
// every test tears its own trigger down via the test-only
// /api/test/clear-distraction-trigger route in a finally block — there is
// no delete UI anywhere in the app for a trigger, so that route is the only
// way back to a clean state. Engineer A's ZZV-prefixed fixtures are theirs;
// never created or deleted by this file.
//
// SEED's profile timezone is America/Chicago (Opus Lead, 2026-08-23) — the
// review window (9pm-4am local) is live for real right now under that zone,
// which is what makes the /review assertions below testable without mocking
// the clock.
//
// The account is shared and actively in motion tonight (Engineer A walking
// /review by hand while this was written), so assertions here are always
// deltas against a baseline read moments before, or presence/absence checks
// on this test's OWN created trigger — never a hardcoded ambient count.

const TRIGGER_NAME = "E2E-DIST Test Trigger";
const TRIGGER_DESCRIPTION = "Created by e2e/distractions.spec.ts";
const DOMAIN = "school"; // any non-Deen domain satisfies "pick a non-Deen domain"
const SEED_TIMEZONE = "America/Chicago"; // see the file header comment

async function deleteTestTriggerIfPresent(page: Page, baseURL: string | undefined, secret: string) {
  const res = await page.request.delete(`${baseURL}/api/test/clear-distraction-trigger`, {
    headers: { "x-e2e-secret": secret },
    data: { name: TRIGGER_NAME, domain: DOMAIN },
  });
  expect(res.ok()).toBe(true);
}

async function openCaptureDialog(page: Page) {
  await page.getByRole("button", { name: "Distractions", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function readHomeDistractionsCount(page: Page): Promise<number> {
  const text = await page.getByTestId("home-distractions-count").textContent();
  return Number(text);
}

test.describe("Distractions", () => {
  test("capture: create a trigger, then tap it again as an existing one — both close the dialog in one tap and increment Home's count", async ({
    page,
    baseURL,
  }) => {
    const secret = process.env.E2E_TEST_SECRET;
    if (!secret) test.skip(true, "E2E_TEST_SECRET not set — see .env.local");

    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);
    await deleteTestTriggerIfPresent(page, baseURL, secret!); // clears any stray copy from an interrupted run

    try {
      const baselineCount = await readHomeDistractionsCount(page);

      // --- Create a brand-new trigger via "+ New trigger" ---
      await openCaptureDialog(page);
      await page.getByRole("button", { name: "School" }).click();
      await page.getByRole("button", { name: /new trigger/i }).click();
      await page.getByPlaceholder("Trigger name").fill(TRIGGER_NAME);
      await page.getByPlaceholder("Explain the trigger").fill(TRIGGER_DESCRIPTION);
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();

      await expect
        .poll(() => readHomeDistractionsCount(page), { timeout: 10_000, intervals: [250, 500, 1000] })
        .toBe(baselineCount + 1);
      const afterCreateCount = await readHomeDistractionsCount(page);

      // --- The new trigger now appears in its domain's list ---
      await openCaptureDialog(page);
      await page.getByRole("button", { name: "School" }).click();
      await expect(page.getByRole("button", { name: TRIGGER_NAME })).toBeVisible();

      // --- Tapping it (an existing trigger) logs another event and closes
      //     the dialog in one tap — no second click, no confirmation step. ---
      await page.getByRole("button", { name: TRIGGER_NAME }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();

      await expect
        .poll(() => readHomeDistractionsCount(page), { timeout: 10_000, intervals: [250, 500, 1000] })
        .toBe(afterCreateCount + 1);
    } finally {
      await deleteTestTriggerIfPresent(page, baseURL, secret!);
      await openCaptureDialog(page);
      await page.getByRole("button", { name: "School" }).click();
      await expect(page.getByRole("button", { name: TRIGGER_NAME })).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
  });

  test("capture: the Deen domain step shows the Light/Moderate/Heavy control; every other domain does not", async ({ page }) => {
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);

    // Read-only for both branches — selecting a domain fetches its trigger
    // list but creates nothing, so there's no state to tear down here.
    await openCaptureDialog(page);
    await page.getByRole("button", { name: "Deen" }).click();
    await expect(page.getByText("Reflection (optional)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Light" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Moderate" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Heavy" })).toBeVisible();
    await page.keyboard.press("Escape");

    for (const domain of ["Business", "School", "Fitness", "Work"]) {
      await openCaptureDialog(page);
      await page.getByRole("button", { name: domain, exact: true }).click();
      await expect(page.getByText("Reflection (optional)")).not.toBeVisible();
      await page.keyboard.press("Escape");
    }
  });

  test("Home's Action Plan dialog excludes a trigger with no current plan; /review shows it as required-plan-only with no follow/skip choice", async ({
    page,
    baseURL,
  }) => {
    const secret = process.env.E2E_TEST_SECRET;
    if (!secret) test.skip(true, "E2E_TEST_SECRET not set — see .env.local");

    // /review redirects to "/" outside its 9pm-4am local window
    // (isReviewOpen, lib/distractions/plan-rules.ts) — imported rather than
    // re-derived here so this can't silently drift from the real rule.
    // Rather than a permanently-red spec outside that window (which trains
    // everyone to ignore red — that's how tonight's ship-on-stale-e2e
    // happened) or a test-only clock override (a production backdoor whose
    // only job is to make production lie about the time), this skips loudly
    // and says exactly why, so a green run means "everything that could run
    // did," not "nothing was actually checked."
    const now = new Date();
    if (!isReviewOpen(now, SEED_TIMEZONE)) {
      test.skip(
        true,
        `/review is only open 9pm-4am local (isReviewOpen) — it's currently ${now.toLocaleString("en-US", { timeZone: SEED_TIMEZONE })} in ${SEED_TIMEZONE}`
      );
    }

    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);
    await deleteTestTriggerIfPresent(page, baseURL, secret!);

    try {
      // Create the trigger fresh — it has an event today and no plan yet,
      // exactly the isNew state /review and the Action Plan dialog both key off.
      await openCaptureDialog(page);
      await page.getByRole("button", { name: "School" }).click();
      await page.getByRole("button", { name: /new trigger/i }).click();
      await page.getByPlaceholder("Trigger name").fill(TRIGGER_NAME);
      await page.getByPlaceholder("Explain the trigger").fill(TRIGGER_DESCRIPTION);
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();

      // --- Home's Action Plan dialog: plan-less triggers are omitted
      //     outright, not shown greyed out (spec 2026-08-23 §6). ---
      await expect
        .poll(() => readHomeDistractionsCount(page), { timeout: 10_000, intervals: [250, 500, 1000] })
        .toBeGreaterThan(0);
      await page.getByRole("button", { name: "Action Plan" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByText(TRIGGER_NAME)).not.toBeVisible();
      await page.keyboard.press("Escape");

      // --- /review: a plan-less trigger requires a plan textbox, with no
      //     follow/skip question (spec §5). ---
      await page.goto("/review");
      await dismissCheckinDialogIfPresent(page);
      const card = page.getByTestId("review-item-card").filter({ hasText: TRIGGER_NAME });
      await expect(card.getByPlaceholder("Plan of action")).toBeVisible();
      await expect(card.getByRole("button", { name: /didn't follow it/i })).toHaveCount(0);
      await expect(card.getByRole("button", { name: /followed it, it happened anyway/i })).toHaveCount(0);
      // Required: Save stays disabled until a plan is actually typed.
      await expect(card.getByRole("button", { name: "Save" })).toBeDisabled();

      await card.getByPlaceholder("Plan of action").fill("Do the thing instead of the distraction");
      await expect(card.getByRole("button", { name: "Save" })).toBeEnabled();
      await card.getByRole("button", { name: "Save" }).click();
      // handleSaveNewPlan's saveActionPlan() await must resolve (marking the
      // item reviewed client-side) before reloading, or the reload below
      // races the write and still reads the pre-save "no plan yet" state.
      await expect(card.getByPlaceholder("Plan of action")).not.toBeVisible();

      // --- Reload for a fresh server read: the trigger now has a current
      //     plan and is no longer "new," so it reappears with the follow/skip
      //     choice — this is where "refuses an empty submission" is testable. ---
      await page.reload();
      await dismissCheckinDialogIfPresent(page);
      const revisitedCard = page.getByTestId("review-item-card").filter({ hasText: TRIGGER_NAME });
      await expect(revisitedCard.getByRole("button", { name: /followed it, it happened anyway/i })).toBeVisible();
      await revisitedCard.getByRole("button", { name: /followed it, it happened anyway/i }).click();

      const revisionTextarea = revisitedCard.getByPlaceholder("Rewritten plan");
      await expect(revisionTextarea).toBeVisible();
      await expect(revisionTextarea).toHaveValue("");
      await expect(revisitedCard.getByRole("button", { name: "Save" })).toBeDisabled();
    } finally {
      await deleteTestTriggerIfPresent(page, baseURL, secret!);
    }
  });
});
