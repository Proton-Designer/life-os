import { test, expect, type Page } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

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

async function startSession(page: Page, kind: "Deep Work" | "Deep Study") {
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);
  sessionMayBeRunning = true;
  await page.getByRole("button", { name: `Lock In — ${kind}` }).click();
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
    await expect(view.getByRole("button", { name: "Distractions" })).toBeVisible();
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
    await view.getByRole("button", { name: "Distractions" }).click();

    // Anchored to the capture dialog's own first-step heading rather than
    // the word "Distractions" — the trigger says that, the dialog itself
    // never does, and matching on the trigger's label would have found the
    // overlay it lives in and passed for the wrong reason.
    const capture = page.getByRole("dialog", { name: "What's the domain?" });
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

    // The session kept running — the idle Lock In buttons must NOT be back.
    await expect(page.getByRole("button", { name: "Lock In — Deep Work" })).toHaveCount(0);

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
    await expect(page.getByRole("button", { name: "Lock In — Deep Work" })).toBeVisible();
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
