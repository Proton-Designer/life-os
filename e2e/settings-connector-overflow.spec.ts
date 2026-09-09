import { test, expect } from "@playwright/test";
import { login, dismissCheckinDialogIfPresent, settleRoute } from "./helpers";

/**
 * Regression spec for the /settings 320px overflow the Lead found live
 * ("OAuth: lifeos_client_Oqnz20Fqx4YJ2WbhzSFCROot", a 46-char unbroken
 * value, forced doc scrollWidth to 366 against a 320px viewport).
 *
 * TWO SEPARATE FIXES, TWO SEPARATE THINGS THIS FILE HAS TO PROVE (per the
 * Lead's own framing — fixing only the visible trigger would leave the
 * real bug in place):
 *
 * 1. THE DISPLAY IS FRAGILE — components/settings/connector-settings.tsx's
 *    token row needed `min-w-0` on the flex column (so it CAN shrink inside
 *    its flex-wrap parent) and `break-all` on the label/detail spans (so
 *    the text actually wraps once the box can shrink). This is the real
 *    bug: ANY long, unbroken label — not just an OAuth client_id — could
 *    trigger it. Proven here by creating a PAT through the real "Create
 *    token" UI with a deliberately long, unbroken label (not by asserting
 *    CSS class names, which could pass while the actual rendered box still
 *    overflows — see AGENTS.md on asserting the property, not a proxy).
 * 2. THE LABEL ITSELF WAS POOR — app/api/mcp/oauth/token/route.ts now
 *    labels an OAuth-issued token with the DCR client_name ("Claude"), not
 *    the raw client_id. That's covered by lib/mcp/__tests__/oauth.test.ts's
 *    formatOAuthTokenLabel unit tests and app/api/mcp/oauth/token/
 *    __tests__/route.test.ts — no live OAuth round trip needed to prove a
 *    pure string-formatting fix, so it isn't re-proven here.
 *
 * Cleans up the token it creates in `afterEach`, registered before creation
 * per this project's own rule on teardown surviving an assertion failure —
 * a token left behind by a failed run would itself become a long-lived
 * fixture that changes what the NEXT run's connector list actually is.
 */

let createdTokenLabel: string | null = null;

test.afterEach(async ({ page }) => {
  if (!createdTokenLabel) return;
  const row = page.locator(`text=${createdTokenLabel}`).locator("..").locator("..");
  const revoke = row.getByRole("button", { name: "Revoke" });
  if (await revoke.isVisible().catch(() => false)) {
    await revoke.click();
  }
  createdTokenLabel = null;
});

test("a long, unbroken PAT label does not overflow /settings at 320px", async ({ page }) => {
  await login(page);

  // Distinctive AND deliberately unbroken (no spaces) — anchored to this
  // run per AGENTS.md's own rule (never assert on text another row could
  // share), and shaped exactly like the bug that shipped: one long token
  // with no wrap points.
  const longLabel = `overflow-check-${Date.now()}-${"x".repeat(60)}`;
  createdTokenLabel = longLabel;

  await page.goto("/settings");
  await dismissCheckinDialogIfPresent(page);
  await settleRoute(page);

  const connectors = page.locator("#connectors");
  await connectors.scrollIntoViewIfNeeded();
  await connectors.getByLabel(/label/i).fill(longLabel);
  await connectors.getByRole("checkbox").first().check(); // Read permission, minimum to enable Create
  await connectors.getByRole("button", { name: /create token/i }).click();
  await expect(connectors.getByText(longLabel)).toBeVisible();

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    // Re-settle after the resize — a font/layout reflow can briefly widen
    // before wrapping catches up, same reasoning layout-overflow.spec.ts's
    // own waitForSettled documents.
    await page.waitForTimeout(100);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `document scrollWidth (${scrollWidth}) exceeds clientWidth (${clientWidth}) at ${width}px with a long token label present`).toBeLessThanOrEqual(clientWidth + 1);
  }
});
