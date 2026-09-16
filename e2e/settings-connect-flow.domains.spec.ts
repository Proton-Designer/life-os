import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent, settleRoute, checkReliably } from "./helpers";

/**
 * P4-25 -- same connect-link proof as settings-connect-flow.spec.ts, for
 * the domains-mode pair (TabAppSidebar/TabSidebarNav + TabMobileIsland --
 * a genuinely different component tree, not a CSS variant of the legacy
 * one; see nav-reachability.domains.spec.ts's own header for why this
 * needs its own file). Runs under the "Domains Fixture" project (Pixel 7
 * device, seed-domains storageState, playwright.config.ts) -- already
 * mobile-shaped by default, and explicitly pinned to 390px anyway to match
 * the exact figure the P4-21 board file's own Log flagged as unverified.
 *
 * components/settings/connector-settings.tsx itself has no domains/legacy
 * branch at all (Settings is not a domain-gated surface) -- this spec's
 * real job is proving the SHELL (TabAppSidebar's nav, the domains-mode
 * page chrome) doesn't clip or hide the same panel a legacy account sees.
 */
test("connect link flow works and does not overflow under the domains-mode shell at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await dismissCheckinDialogIfPresent(page);
  await settleRoute(page);

  const connectors = page.locator("#connectors");
  await connectors.scrollIntoViewIfNeeded();
  await connectors.getByRole("tab", { name: "Text-based assistant" }).click();

  await checkReliably(connectors.getByRole("checkbox", { name: /Write/ }));
  await connectors.getByRole("button", { name: "Generate connect link" }).click();

  await expect(connectors.getByText(/\/connect\//)).toBeVisible();
  await expect(connectors.getByText(/single use, expires in 10 minutes/i)).toBeVisible();

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `document scrollWidth (${scrollWidth}) exceeds clientWidth (${clientWidth}) at 390px, domains-mode shell`).toBeLessThanOrEqual(clientWidth + 1);
});
