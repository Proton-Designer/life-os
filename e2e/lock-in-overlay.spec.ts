import { test, expect, type Page } from "@playwright/test";
import { dismissCheckinDialogIfPresent, dismissCheckinToastIfPresent, fillReliably, openLockInSetup } from "./helpers";

/**
 * The full-screen Lock-In session view (2026-08-26 night batch 3). Written
 * by the Lead from Ayman's request rather than from the implementation —
 * the point is to check that what he asked for is what shipped.
 *
 * His ask, condensed: starting a Lock-In session brings up a full-screen
 * view naming the session (Deep Work / Deep Study), with a large stopwatch
 * showing MINUTES, the actual current time beneath it, a Distractions
 * button, an End Session button at the bottom, and a minimize button top
 * right. Minimizing keeps the session running and returns to the normal
 * app; the Focus module then offers End session AND Expand; Expand brings
 * the full-screen view back.
 *
 * This is a MUTATING spec — it starts a real work_sessions row on SEED.
 * Teardown is registered before the session is ever created (AGENTS.md:
 * "a spec must clean up on failure, not only on success"), because a
 * session left running is worse than a leftover task row: startWorkSession
 * has a single-active-session guard, so one orphan makes every later run
 * of this file, and Home's Focus module generally, unable to start
 * anything at all.
 */

/** Set as soon as a session is started, cleared once it's confirmed ended. */
let sessionMayBeRunning = false;

/**
 * Teardown goes through a secret-gated API route, not the UI, and that
 * choice was earned: the first run of this file had the feature working and
 * a UI-driven afterEach timing out, which orphaned a session and then failed
 * the next five tests for a reason that had nothing to do with the code.
 * startWorkSession's single-active-session guard means ONE leftover row
 * poisons every later run — so teardown here has to be the most reliable
 * thing in the file, not the most realistic.
 *
 * Registered before any session is ever created (AGENTS.md: "a spec must
 * clean up on failure, not only on success"). The in-test End Session
 * assertions still run and are still real — this is a net beneath them.
 */
test.afterEach(async ({ request, baseURL }) => {
  if (!sessionMayBeRunning) return;
  sessionMayBeRunning = false;
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) return;
  await request
    .post(`${baseURL}/api/test/end-work-session`, { headers: { "x-e2e-secret": secret } })
    .catch(() => undefined);
});

/** The full-screen view, identified the way a screen reader would find it. */
function overlay(page: Page) {
  return page.getByRole("dialog", { name: /locked in/i });
}

/**
 * #37 (2026-09-14, f042c80): clicking "Lock In — <kind>" no longer opens
 * the full-screen session directly — it opens `session-setup-dialog.tsx`'s
 * setup dialog, and the server (`startWorkSessionCore`) now REJECTS a
 * start with no named deliverable, regardless of kind. This helper drives
 * that dialog to a real "Start" click rather than assuming the old
 * one-click flow; every test in this file goes through it.
 *
 * Deep Work: duration + the free-form "Custom objective" field satisfies
 * `hasDeliverable` on its own — no class, no kill-list selection needed.
 *
 * Deep Study additionally requires picking a class (`canStart`'s
 * `!isDeepStudy || classId !== null`). This picks whichever class is
 * FIRST in the live list — deliberately not a specific name, since this
 * spec does not own or seed SEED's class data — then satisfies the
 * objective requirement via "Study Material" custom text rather than
 * selecting a due-soon task, because task availability depends on live
 * due-date data this spec has no control over and Study Material does not.
 * If SEED has no classes at all, the Deep Study path cannot be exercised
 * at all (Start stays disabled forever with no class selected) — skipped
 * with a clear reason rather than hanging until the test timeout, same
 * "don't measure what isn't there" discipline playwright.config.ts's own
 * comment on the domains-mode specs documents for an empty table.
 */
async function startSession(page: Page, kind: "Deep Work" | "Deep Study") {
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);
  // Guards the same class of flake found live in e2e/goals.spec.ts
  // (2026-09-15): the allocation check-in toast fires on its own timer and
  // can appear mid-test, unrelated to anything this spec does — see
  // dismissCheckinToastIfPresent's own header.
  await dismissCheckinToastIfPresent(page);
  await openLockInSetup(page, kind);

  const setupDialog = page.getByRole("dialog", { name: /set a goal/i });
  await expect(setupDialog).toBeVisible();

  await fillReliably(setupDialog.getByLabel("Duration in minutes"), "25");

  const objectiveText = `e2e-lockin-${Date.now()}`;
  if (kind === "Deep Study") {
    await expect(setupDialog.getByText("Loading classes…")).toHaveCount(0);
    const noClasses = setupDialog.getByText("No classes yet");
    // The class list's own ObjectiveRow buttons — queried before any class
    // is picked, so this can only match class rows, not the task list
    // (which doesn't exist in the DOM yet).
    const firstClassRow = setupDialog.locator("button[aria-pressed]").first();
    // Wait for the dialog to settle into ONE of its two real terminal
    // states (SEED has 6 classes today, so the empty state should never
    // actually win) rather than deciding off an instant `.count()`
    // snapshot the moment "Loading classes…" disappears — that snapshot
    // can race the very next render tick and read zero for BOTH locators,
    // which would have skipped this test even though classes genuinely
    // exist (the same false-skip shape the Lead found live in
    // goals.spec.ts, applied here to `.count()` instead of `isVisible()`).
    await expect(noClasses.or(firstClassRow)).toBeVisible();
    if (await noClasses.isVisible()) {
      test.skip(true, "SEED has no classes — #37's Deep Study gate (a class selection) cannot be exercised without one.");
    }
    await firstClassRow.click();
    await setupDialog.getByRole("button", { name: "Study Material" }).click();
    await fillReliably(setupDialog.getByLabel("Study material"), objectiveText);
  } else {
    await fillReliably(setupDialog.getByLabel("Custom objective"), objectiveText);
  }

  await dismissCheckinToastIfPresent(page);
  sessionMayBeRunning = true;
  await setupDialog.getByRole("button", { name: "Start" }).click();
  await expect(setupDialog).toBeHidden();
}

test.describe("Lock-In full-screen session view", () => {
  test("starting a session opens a full-screen view with everything he asked for", async ({ page }) => {
    await startSession(page, "Deep Work");

    const view = overlay(page);
    await expect(view).toBeVisible();

    // Names the session.
    await expect(view.getByText("Deep Work", { exact: false }).first()).toBeVisible();

    // A stopwatch in MINUTES — not h:mm, not seconds. A session that just
    // started reads 0, and the unit is spelled out beside it so a bare
    // number can't be misread as hours.
    await expect(view.getByText("min", { exact: true })).toBeVisible();
    await expect(view.getByText(/^\d+$/).first()).toBeVisible();

    // ...and the actual wall clock beneath it. Asserted as a shape rather
    // than a value: pinning the exact string would make this a test of the
    // runner's clock and timezone, which is the bug class AGENTS.md warns
    // about, not a test of the feature.
    await expect(view.getByText(/\d{1,2}:\d{2}\s*(AM|PM)?/i).first()).toBeVisible();

    // The three controls.
    await expect(view.getByRole("button", { name: "Log a distraction" })).toBeVisible();
    await expect(view.getByRole("button", { name: /^End Session$/i })).toBeVisible();
    await expect(view.getByRole("button", { name: "Minimize session" })).toBeVisible();
  });

  test("the full-screen view actually covers the app chrome", async ({ page }) => {
    // Pin a phone viewport explicitly. The nav pill is `lg:hidden`, so at a
    // desktop width it is present in the DOM but not rendered, and every
    // measurement below would come back empty — a test reporting a pass
    // having examined nothing, exactly what AGENTS.md warns about.
    await page.setViewportSize({ width: 390, height: 844 });
    await startSession(page, "Deep Work");
    await expect(overlay(page)).toBeVisible();

    const pill = page.locator('[data-testid="mobile-island-item-home"]');
    await expect(pill).toBeVisible();

    // The defect this guards: the overlay first shipped at z-40 while the
    // mobile nav pill sits at z-50, so the floating nav would have painted
    // ON TOP of the "full screen" view. jsdom computes no z-index at all,
    // so no unit test can see this.
    //
    // Asserted as a numeric comparison rather than by hit-testing, and that
    // is a deliberate correction: elementFromPoint LOOKS like the honest
    // question ("what does he actually hit here?") but is worthless for
    // this, because Radix's modal layer sets `pointer-events: none` on the
    // body while the overlay is open. Measured during authoring: with the
    // overlay forced back to z-40, elementFromPoint still reported the pill
    // as not-on-top — the hit test passed while the bug was present. It was
    // measuring Radix's pointer-events, not stacking order.
    //
    // Both elements are position:fixed children of the root stacking
    // context, so their z-index values are directly comparable. Measured
    // today: nav 50, overlay 60. The original bug was 40, which fails this.
    const z = await overlay(page).evaluate((dialog: HTMLElement) => {
      const nav = document
        .querySelector('[data-testid="mobile-island-item-home"]')
        ?.closest("nav") as HTMLElement | null;
      return {
        overlay: Number(getComputedStyle(dialog).zIndex),
        nav: nav ? Number(getComputedStyle(nav).zIndex) : NaN,
      };
    });

    expect(Number.isFinite(z.overlay), "overlay has no numeric z-index — nothing was measured").toBe(true);
    expect(Number.isFinite(z.nav), "nav pill has no numeric z-index — nothing was measured").toBe(true);
    expect(z.overlay, `overlay z-index ${z.overlay} must beat the nav pill's ${z.nav}`).toBeGreaterThan(z.nav);
  });

  test("Distractions opens from inside the view and closes back to it", async ({ page }) => {
    await startSession(page, "Deep Work");
    const view = overlay(page);
    // P3-02: visible label is now "+1" (accessible name "Log a distraction"
    // via aria-label) -- an active session still infers the domain and
    // skips straight to the trigger list, unchanged.
    await view.getByRole("button", { name: "Log a distraction" }).click();

    // components/distractions/distraction-capture-dialog.tsx now INFERS the
    // domain from the active session (2026-09-10, Ayman/Opus Lead: "one
    // fewer tap inside a session") and jumps straight past the "What's the
    // domain?" picker step to the triggers step, shown "silently but not
    // hidden" via a DialogDescription — Deep Work infers "business"
    // (inferDomainFromSession), so this anchors on that description text
    // rather than the domain-picker heading, which a live session never
    // shows at all anymore.
    const capture = page.getByRole("dialog").filter({ hasText: "Inferred from your Deep Work session" });
    await expect(capture).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(capture).toBeHidden();
    // Closing the inner dialog must not also close the session view.
    await expect(view).toBeVisible();
  });

  test("minimize keeps the session running and returns to the app; Expand brings it back", async ({ page }) => {
    await startSession(page, "Deep Work");
    const view = overlay(page);
    await view.getByRole("button", { name: "Minimize session" }).click();
    await expect(view).toBeHidden();

    // "it returns to the normal app screen" — the app must be genuinely
    // usable again, not merely visible. A lingering scroll-lock or
    // pointer-events from the modal layer is the classic failure here, and
    // it looks identical to a working page in a screenshot.
    const home = page.locator('[data-testid="mobile-island-item-home"]');
    if (await home.count()) await expect(home).toBeEnabled();
    await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none");

    // "in the focus module it shoudl show end session and also a Expand button"
    await expect(page.getByRole("button", { name: "Expand" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^End session$/i }).first()).toBeVisible();

    // The session kept running — the idle Lock In button must NOT be back.
    await expect(page.getByRole("button", { name: "Lock In", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Expand" }).click();
    await expect(overlay(page)).toBeVisible();
  });

  test("minimized state survives navigation — it does not re-take the screen on every page load", async ({ page }) => {
    await startSession(page, "Deep Work");
    await overlay(page).getByRole("button", { name: "Minimize session" }).click();
    await expect(overlay(page)).toBeHidden();

    // The whole point of persisting the flag: he minimized it once, and
    // walking to another page must not undo that decision.
    await page.goto("/business");
    await dismissCheckinDialogIfPresent(page);
    await expect(overlay(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "Expand" }).first()).toBeVisible();
  });

  test("End Session from the full-screen view ends it everywhere", async ({ page }) => {
    await startSession(page, "Deep Work");
    const view = overlay(page);
    await view.getByRole("button", { name: /^End Session$/i }).click();

    await expect(view).toBeHidden();
    // Home is back to offering a fresh session, which is the real proof the
    // row was closed rather than just hidden client-side.
    await expect(page.getByRole("button", { name: "Lock In", exact: true })).toBeVisible();
    sessionMayBeRunning = false;
  });

  test("a Deep Study session names itself Deep Study, not Deep Work", async ({ page }) => {
    await startSession(page, "Deep Study");
    const view = overlay(page);
    await expect(view).toBeVisible();
    await expect(view.getByText("Deep Study", { exact: false }).first()).toBeVisible();
    await expect(view.getByText("Deep Work", { exact: false })).toHaveCount(0);
  });
});
