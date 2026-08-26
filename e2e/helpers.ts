import { Page, expect } from "@playwright/test";

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
  await expect(page).toHaveURL(/\/$/);
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
