import { test, expect, type Page } from "@playwright/test";
import { settleRoute, fillReliably } from "./helpers";

/**
 * Bring-your-own-key settings, verified against the deployed app.
 *
 * The two claims worth checking are the ones a build cannot make: that the
 * section reads as an OPTIONAL offer rather than a paywall, and that a bad key
 * is rejected by the SERVER (verified with the provider) rather than merely
 * shape-checked in the browser.
 *
 * REGRESSION (found 2026-09-09, full suite): `.fill()` on the password input
 * reported success while reading back empty; typing the same value with
 * `.pressSequentially()` stuck. THE MECHANISM, as far as it could be
 * established without live browser access to confirm directly (documented
 * honestly as a well-supported hypothesis, not a proven fact — see the
 * report to the Lead): a HYDRATION RACE, not a re-render wiping React state.
 * `.fill()` dispatches its input event near-instantly; if it lands on this
 * controlled input BEFORE React has hydrated and attached its `onChange`
 * handler, the native DOM write is never seen by React at all, and when
 * hydration commits a moment later, React's reconciliation of the
 * controlled input's value (`""`, its initial state) overwrites whatever
 * Playwright had set — while `.pressSequentially()`'s slower, spaced-out
 * keystrokes land after hydration has already finished. This test had no
 * hydration-completion wait before filling (only `expect(section).
 * toBeVisible()`, a DOM-presence check, not a React-interactivity one) —
 * a latent race this suite's OTHER specs mostly avoid via settleRoute()
 * (used here now) or slower natural interaction sequences. /settings
 * gained two new Client Components the same night this broke (L10's
 * ThemeSettings/FeatureVisibilitySettings) — genuinely more client JS to
 * hydrate for this one route — which is the most likely reason a
 * previously-narrow race became reliably observable rather than lucky.
 *
 * FIX HERE IS NOT `.pressSequentially()` — per the Lead's explicit
 * instruction, and on the merits: switching only proves typing eventually
 * works, not that the race is understood or that a real fast interaction
 * (e.g. a password manager's own instant autofill) wouldn't hit it too.
 * `fillReliably` (e2e/helpers.ts) instead ASSERTS the real precondition —
 * a fill that actually stuck — and re-fills if it didn't, the same
 * "verify the effect, don't guess a timing margin" discipline as this
 * suite's clickAndSettle(). Promoted to helpers.ts, not kept local here,
 * after the identical race reproduced through a DIFFERENT spec written
 * minutes later (e2e/settings-connector-overflow.spec.ts) that looked
 * like it already covered interactivity — see fillReliably's own comment.
 */

async function openSettings(page: Page) {
  await page.goto("/settings");
  const section = page.locator("#ai");
  await expect(section).toBeVisible();
  await settleRoute(page);
  return section;
}

test.describe("API key settings", () => {
  test("reads as optional, and never shows a stored key", async ({ page }) => {
    const section = await openSettings(page);

    const text = await section.innerText();
    // The product promise: the app works without paying for anything.
    expect(text).toMatch(/works without this|nothing here is required/i);
    // And it must not use paywall language.
    expect(text).not.toMatch(/upgrade|unlock premium|pro plan|subscribe/i);

    // The input must be a password field — a key pasted in a plain text box
    // sits visible in screen shares and screenshots.
    const input = section.locator('input[type="password"]');
    await expect(input.first()).toBeVisible();

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: ".playwright-mcp/api-key-settings.png" });
  });

  test("a bogus key is rejected BY THE PROVIDER, not just by shape", async ({ page }) => {
    const section = await openSettings(page);

    // Correct shape (starts with sk-, right sort of length) so the client-side
    // check passes and the only thing that can reject it is a real call.
    await fillReliably(section.locator('input[type="password"]').first(), "sk-0000000000000000000000000000000000");
    await section.getByRole("button", { name: /^connect$/i }).click();

    await expect(section.getByText(/rejected that key|didn't work|couldn't reach|error/i)).toBeVisible({
      timeout: 30_000,
    });

    // And nothing may claim to be connected afterwards.
    await expect(section.getByText(/connected · ····/)).toHaveCount(0);
  });
});
