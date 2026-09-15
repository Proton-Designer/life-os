import { test, expect, type Page } from "@playwright/test";
import { dismissCheckinDialogIfPresent, fillReliably } from "./helpers";

/**
 * #52: a distraction logged during an active Lock-In session links to that
 * session (distraction_events.session_id, migration 169) and shows a live
 * "N this session" count next to the Distractions button
 * (components/distractions/distraction-capture-dialog.tsx's
 * SessionDistractionCounter) — bumped immediately after a local log, not
 * only on its own 60s poll tick, so this is testable without waiting a
 * real minute.
 *
 * DOES NOT REUSE e2e/lock-in-overlay.spec.ts's own `startSession()` helper
 * — that helper only clicks "Lock In — Deep Work" and asserts the
 * full-screen view immediately, with no interaction with the setup dialog
 * at all. Read against the real component (components/business/
 * lock-in-overlay-context.tsx's `startSession` callback only ever opens
 * the setup dialog, `setSetupOpenState(true)` — it never starts a session
 * by itself), that helper looks stale relative to #37's gate. This spec
 * starts a session through the REAL flow instead: open the dialog, set a
 * duration, name a custom objective (satisfies #37's gate independent of
 * today's kill-list state, which this real account's own data controls),
 * click Start.
 *
 * MUTATING: starts a real `work_sessions` row and creates a real
 * `distraction_triggers` row (cascading to its one `distraction_events`
 * row) on SEED. Session teardown mirrors lock-in-overlay.spec.ts's own
 * `sessionMayBeRunning` + secret-gated `/api/test/end-work-session`
 * pattern in `afterEach`, so a mid-test assertion failure still can't
 * leave a session running on Ayman's real account — the explicit "End
 * Session" click below is the real assertion this spec makes, not the
 * only thing standing between a failure and a leaked session. Ending IS
 * exercised directly (not skipped) because lock-in-overlay.spec.ts's own
 * "End Session from the full-screen view ends it everywhere" test already
 * proves that specific click is reliable — nothing new or awkward about
 * it here. Trigger teardown runs in the test's own `finally`, using a
 * unique per-run name so a repeated run (or a run overlapping
 * e2e/distractions.spec.ts's own fixed-name trigger) can never collide.
 */

let sessionMayBeRunning = false;

test.afterEach(async ({ request, baseURL }) => {
  if (!sessionMayBeRunning) return;
  sessionMayBeRunning = false;
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) return;
  await request
    .post(`${baseURL}/api/test/end-work-session`, { headers: { "x-e2e-secret": secret } })
    .catch(() => undefined);
});

function overlay(page: Page) {
  return page.getByRole("dialog", { name: /locked in/i });
}

async function startDeepWorkSession(page: Page, objective: string) {
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);
  sessionMayBeRunning = true;
  await page.getByRole("button", { name: "Lock In — Deep Work" }).click();

  const setup = page.getByRole("dialog", { name: /set a goal/i });
  await expect(setup).toBeVisible();
  await fillReliably(setup.getByLabel("Duration in minutes"), "25");
  // #37's gate: a named custom objective, not a kill-list selection —
  // deterministic regardless of what's actually on today's real kill list.
  await fillReliably(setup.getByLabel("Custom objective"), objective);
  await expect(setup.getByRole("button", { name: "Start" })).toBeEnabled();
  await setup.getByRole("button", { name: "Start" }).click();
  await expect(setup).toBeHidden();
  await expect(overlay(page)).toBeVisible();
}

test("a distraction logged during a Lock-In session shows a live '1 this session' count, then End Session ends it", async ({
  page,
  baseURL,
}) => {
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) {
    test.skip(true, "E2E_TEST_SECRET not set — see .env.local");
  }

  const triggerName = `E2E-LOCKIN-DIST-${Date.now()}`;
  const triggerDomain = "business"; // inferDomainFromSession maps deep_work -> business

  try {
    await startDeepWorkSession(page, `e2e-lockin-distraction-count-${Date.now()}`);
    const view = overlay(page);

    await view.getByRole("button", { name: "Distractions" }).click();
    const capture = page.getByRole("dialog");
    await expect(capture).toBeVisible();

    // Deep Work is supposed to infer the "business" domain and skip
    // straight to the trigger-list step (distraction-capture-dialog.tsx's
    // own inferDomainFromSession) — but this is asserted defensively
    // rather than assumed: if the domain step is showing anyway, pick
    // Business explicitly rather than fail on an inference detail that
    // isn't this spec's own subject.
    const businessDomainButton = capture.getByRole("button", { name: "Business", exact: true });
    if (await businessDomainButton.isVisible().catch(() => false)) {
      await businessDomainButton.click();
    }
    await expect(capture.getByRole("button", { name: /new trigger/i })).toBeVisible();

    await capture.getByRole("button", { name: /new trigger/i }).click();
    await fillReliably(capture.getByPlaceholder("Trigger name"), triggerName);
    await capture.getByRole("button", { name: "Save" }).click();
    await expect(capture).toBeHidden();

    // Bumped immediately after the local log (sessionLogBump), not only on
    // the counter's own 60s poll tick — no real-time wait needed.
    await expect(view.getByText("1 this session")).toBeVisible({ timeout: 10_000 });

    await view.getByRole("button", { name: /^End Session$/i }).click();
    await expect(view).toBeHidden();
    // The real proof the row was closed, not merely hidden client-side —
    // Home offers a fresh session again (lock-in-overlay.spec.ts's own
    // "End Session" test uses the identical assertion).
    await expect(page.getByRole("button", { name: "Lock In — Deep Work" })).toBeVisible();
    sessionMayBeRunning = false;
  } finally {
    await page.request
      .delete(`${baseURL}/api/test/clear-distraction-trigger`, {
        headers: { "x-e2e-secret": secret! },
        data: { name: triggerName, domain: triggerDomain },
      })
      .catch(() => undefined);
  }
});
