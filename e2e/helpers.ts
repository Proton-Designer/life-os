import { Page, Locator, expect } from "@playwright/test";

export async function login(page: Page) {
  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("SEED_USER_EMAIL / SEED_USER_PASSWORD must be set (see .env.local)");
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The default 5s assertion timeout is tuned for localhost and is too tight
  // for a cold production start (a serverless cold start plus the Supabase
  // auth round trip can exceed it) — Opus Lead hit this post-deploy
  // (2026-08-26): auth.setup.ts failed twice against prod, looking exactly
  // like login was broken, while the token endpoint was returning a valid
  // 200 the whole time and a by-hand login succeeded, just slower than 5s.
  // Scoped to this one known-slow step, not a blanket global timeout raise.
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
}

// The real CheckinScheduler (lib/checkins/compute-checkin-slots.ts) mounts on
// every authenticated page and can pop its Dialog the moment a check-in slot
// is genuinely due for this real account — independent of anything a given
// spec is testing, and it covers the page and intercepts clicks when it does.
// Escape triggers the Dialog's onOpenChange(false) → snoozeCheckin(), which
// deliberately persists nothing (a snooze isn't an answer, per Task 10.2), so
// this is safe to call defensively without altering real account data.
export async function dismissCheckinDialogIfPresent(page: Page) {
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
}

/**
 * Waits until the route's loading.tsx skeleton has been replaced by real
 * content.
 *
 * Batch 5 added a `loading.tsx` to every route, which means each one now has
 * a real Suspense boundary and streams. `page.goto()` therefore resolves as
 * soon as the SHELL plus the fallback arrive — not, as before, only once the
 * whole page had server-rendered. Anything that reads the DOM without
 * auto-waiting now lands in that window and sees the skeleton:
 *
 *   - `locator.all()` does NOT auto-wait; it returns `[]` if the elements
 *     aren't there yet (this is what broke fitness-daily-log.spec.ts — a
 *     destructured `const [x] = await ....all()` yielded `undefined`).
 *   - `locator.textContent()` resolves against whatever exists at that
 *     instant, so a "read the current value, then branch on it" step can
 *     silently take the wrong branch.
 *   - React's streaming briefly holds resolved content in a hidden container
 *     before relocating it, so a strict-mode locator can transiently match
 *     two copies of the same node.
 *
 * `expect(...).toBeVisible()` and friends auto-retry and are unaffected —
 * this is only needed before a NON-waiting read. Prefer an auto-waiting
 * assertion where you can; use this where you genuinely must read raw DOM.
 */
export async function settleRoute(page: Page) {
  await expect(page.locator(".route-skeleton-fade-in")).toHaveCount(0);
}

/**
 * Waits for a mutation click to fully settle before it's safe to navigate
 * away. Two things have to both be true, not just one (proved the hard way
 * in e2e/deen.spec.ts, commit 8d63978):
 *
 * 1. The Server Action's own response has to come back — an optimistic
 *    handler (useOptimistic + startTransition) paints synchronously, so a
 *    class/text assertion right after the click can pass on the OPTIMISTIC
 *    paint alone, a tick before the real Supabase round trip lands.
 * 2. The page has to stay put until ALL of that click's network activity is
 *    done, not just the first response — `page.goto()` tears down the
 *    current page's execution context, which cancels any of ITS still-
 *    in-flight requests. A live capture showed one click fan out into ~5
 *    sequential POSTs (the action itself plus revalidation chatter);
 *    racing a navigation in before the last one finishes can silently
 *    abort the write entirely — not just read it stale, actually never
 *    persist it. `await expect(button).toBeEnabled()` doesn't catch this
 *    either: `isPending` flips true on React's NEXT render, not
 *    synchronously with the click, so a poll can land in that gap and pass
 *    immediately.
 *
 * `networkidle` here is doing something different than a network-idle wait
 * used as a general race-avoidance guess on a DESTINATION page (rightly
 * rejected elsewhere in this suite): this is on the SOURCE page, before
 * ever navigating — not inferring completion from elapsed time, but
 * refusing to cancel the real request by leaving before it's actually
 * done. Confirmed directly: an isolated click followed immediately by
 * `page.goto()` left the write missing entirely — not stale, genuinely
 * never written — while the same click followed by this wait, on the SAME
 * page, before navigating anywhere, committed reliably across repeated
 * runs.
 */
export async function clickAndSettle(page: Page, target: import("@playwright/test").Locator) {
  await target.click();
  await page.waitForLoadState("networkidle");
}

/**
 * Fills a controlled input, then VERIFIES the fill actually stuck — retrying
 * a bounded number of times, and failing loudly (a real assertion, not a
 * silent give-up) if it never does.
 *
 * WHY THIS EXISTS, not `.fill()` alone (found 2026-09-09, `e2e/
 * api-key-settings.spec.ts`, confirmed live by the Lead): a HYDRATION RACE.
 * `.fill()` dispatches its input event near-instantly. If it lands on a
 * controlled input BEFORE React has hydrated and attached that input's
 * `onChange` handler, the native DOM write is never seen by React at all —
 * then hydration commits a moment later and React reconciles the
 * controlled value against its own initial state (typically `""`),
 * silently overwriting whatever was just typed. `settleRoute()` alone does
 * NOT close this gap — it waits for the loading.tsx skeleton to be gone,
 * which is a CONTENT signal, not a React-interactivity one, and this exact
 * race reproduced through it (`e2e/settings-connector-overflow.spec.ts`,
 * written minutes after the fix above, hit the identical failure through
 * the identical gap).
 *
 * `pressSequentially()` also survives this race (its keystrokes are spaced
 * out enough that hydration has usually finished by the time they land),
 * but switching to it treats the SYMPTOM as the fix: it proves typing
 * eventually works, not that the race is understood, and doesn't help a
 * real fast interaction (a password manager's instant autofill) that hits
 * the same window. This helper instead asserts the actual precondition —
 * a fill that landed — which is the same "verify the effect, don't guess a
 * timing margin" discipline as `clickAndSettle` above.
 *
 * Default, not a special case: any spec filling a controlled input on a
 * page that might still be hydrating should reach for this rather than a
 * bare `.fill()` — see this comment's own second data point for how easily
 * the race gets reintroduced by a spec that looks like it already covers
 * interactivity (`await expect(section).toBeVisible()` before filling —
 * DOM presence, not React readiness).
 */
export async function fillReliably(locator: Locator, value: string, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await locator.fill(value);
    if ((await locator.inputValue()) === value) return;
    await locator.page().waitForTimeout(150);
  }
  // Let the final attempt's real value drive a real assertion failure with
  // a clear message, rather than silently giving up after `attempts` tries.
  await expect(locator).toHaveValue(value);
}

/** Same race, same fix, for a checkbox/radio: `.check()`, verify `.isChecked()`, retry. See fillReliably's own comment for the full mechanism. */
export async function checkReliably(locator: Locator, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await locator.check();
    if (await locator.isChecked()) return;
    await locator.page().waitForTimeout(150);
  }
  await expect(locator).toBeChecked();
}
