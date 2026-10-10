import { test, expect, type Page } from "@playwright/test";
import { dismissCheckinDialogIfPresent, settleRoute } from "./helpers";
import { useDeenMode } from "./deen-mode-helpers";

// These flows need Faith visible (DEEN-09): put the account in Deen Mode ON for
// the file and restore its prior value afterwards, rather than trusting fixture state.
useDeenMode(test);

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
// The account is shared and actively in motion tonight (Engineer A walking
// /review by hand while this was written), so assertions here are always
// deltas against a baseline read moments before, or presence/absence checks
// on this test's OWN created trigger — never a hardcoded ambient count.

const TRIGGER_NAME = "E2E-DIST Test Trigger";
const TRIGGER_DESCRIPTION = "Created by e2e/distractions.spec.ts";
const DOMAIN = "school"; // any non-Faith domain satisfies "pick a non-Faith domain"

async function deleteTestTriggerIfPresent(page: Page, baseURL: string | undefined, secret: string) {
  const res = await page.request.delete(`${baseURL}/api/test/clear-distraction-trigger`, {
    headers: { "x-e2e-secret": secret },
    data: { name: TRIGGER_NAME, domain: DOMAIN },
  });
  expect(res.ok()).toBe(true);
}

/**
 * P3-02: with no active Lock-In session, the dialog now opens on a
 * "+1"-driven quick-chip step ("What happened?") when the account already
 * has triggers, instead of landing on the domain picker directly -- every
 * test in this file wants the domain-first flow specifically (they're
 * testing domain/trigger-list mechanics, not the new fast path), so this
 * steps through "More options" when that's what appeared. A genuinely
 * fresh account with zero triggers skips the chip step automatically
 * (the dialog's own empty-fallback) and lands on the domain picker
 * directly, which this also handles.
 */
async function openCaptureDialog(page: Page) {
  await page.getByRole("button", { name: "Log a distraction" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("What happened?").or(page.getByText("What's the domain?"))).toBeVisible();
  // A zero-trigger account (the fresh legacy SEED) first paints "What happened?" and then, once its trigger
  // list resolves empty, swaps itself to the domain picker, so "More options" can vanish between
  // isVisible() and click() (E2E-01: 30 s of "element was detached, retrying"). Re-evaluate until the
  // domain step is actually showing instead of committing to one click.
  await expect(async () => {
    const more = page.getByRole("button", { name: "More options" });
    if (await more.isVisible()) await more.click({ timeout: 2_000 }).catch(() => {});
    await expect(page.getByText("What's the domain?")).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
}

async function readHomeDistractionsCount(page: Page): Promise<number> {
  const text = await page.getByTestId("home-distractions-count").textContent();
  return Number(text);
}

// Real prod latency: each test makes several server round trips (dialog data, the cleanup route) and the
// whole run shares one account, so give them the slow-test budget rather than the 30 s default.
test.beforeEach(() => {
  test.slow();
});

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
      // settleRoute FIRST: textContent() (inside readHomeDistractionsCount)
      // does not reliably wait out Home's loading.tsx skeleton, and a
      // baseline read against the skeleton would corrupt every delta
      // assertion below it, not just this one read.
      await settleRoute(page);
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

  test("capture: the Faith domain step shows the Light/Moderate/Heavy control; every other domain does not", async ({ page }) => {
    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);

    // Read-only for both branches — selecting a domain fetches its trigger
    // list but creates nothing, so there's no state to tear down here.
    await openCaptureDialog(page);
    await page.getByRole("button", { name: "Faith" }).click();
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

  test("Home's Action Plan dialog (the one shared review) shows a plan-less trigger as required-plan-only with no follow/skip choice, and follow/skip appears once it has a plan", async ({
    page,
    baseURL,
  }) => {
    const secret = process.env.E2E_TEST_SECRET;
    if (!secret) test.skip(true, "E2E_TEST_SECRET not set — see .env.local");

    // IA-P1b: the review is no longer window-gated (the 9pm topbar popup is gone); Home's Action Plan
    // dialog and the evening close render the same DistractionPlanReview at any hour.
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

      await expect
        .poll(() => readHomeDistractionsCount(page), { timeout: 10_000, intervals: [250, 500, 1000] })
        .toBeGreaterThan(0);

      // --- Home's Action Plan dialog = the shared review: a plan-less trigger from today asks for a
      //     plan (textbox, Save disabled until typed) with NO follow/skip question (spec §5). ---
      await page.getByRole("button", { name: "Action Plan" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const card = page.getByTestId("review-item-card").filter({ hasText: TRIGGER_NAME });
      await expect(card.getByPlaceholder("Plan of action")).toBeVisible();
      await expect(card.getByRole("button", { name: /didn't follow it/i })).toHaveCount(0);
      await expect(card.getByRole("button", { name: /followed it, it happened anyway/i })).toHaveCount(0);
      await expect(card.getByRole("button", { name: "Save" })).toBeDisabled();

      await card.getByPlaceholder("Plan of action").fill("Do the thing instead of the distraction");
      await expect(card.getByRole("button", { name: "Save" })).toBeEnabled();
      await card.getByRole("button", { name: "Save" }).click();
      // The card collapses to "Saved" at once (optimistic); wait for it before reloading so the
      // reload doesn't abort the in-flight Server Action.
      await expect(card.getByText("Saved")).toBeVisible();
      await settleRoute(page);

      // --- Fresh read: the trigger now has a plan, so it reappears with the follow/skip choice,
      //     where "refuses an empty rewrite" is testable. ---
      await page.reload();
      await dismissCheckinDialogIfPresent(page);
      await page.getByRole("button", { name: "Action Plan" }).click();
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
