import { test, expect } from "@playwright/test";
import { login, dismissCheckinDialogIfPresent, settleRoute, checkReliably } from "./helpers";

/**
 * P4-25 -- the P4-21 "connect your agent" link flow, exercised live on
 * legacy-mode SEED. Runs under BOTH "Desktop Chrome" and "Mobile Chrome"
 * (playwright.config.ts), same convention as nav-reachability.spec.ts --
 * no project-specific code needed. The domains-mode pair is
 * settings-connect-flow.domains.spec.ts (a genuinely different component
 * tree, not a CSS variant -- see that file's own header).
 *
 * Stops short of actually exchanging the generated code: that would mint a
 * real, live mcp_access_tokens row on SEED with no UI path back to
 * revoking it from this spec alone (the connect-link generator only ever
 * hands back the raw code, never the token). The unexchanged code is
 * single-use and expires in 10 minutes on its own -- the same
 * self-cleaning posture P3-08's own share-link tests rely on -- so no
 * afterEach teardown is needed here, unlike settings-connector-overflow's
 * PAT (which lives until revoked).
 */
test("generates a one-click connect link with the caller's own chosen scope, no overflow at 390px", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/settings");
  await dismissCheckinDialogIfPresent(page);
  await settleRoute(page);

  const connectors = page.locator("#connectors");
  await connectors.scrollIntoViewIfNeeded();
  await connectors.getByRole("tab", { name: "Text-based assistant" }).click();

  // Write is NOT checked by default -- the generated link must reflect
  // exactly what was chosen (read + write here), never a blanket default
  // (Opus Lead's own P4-21 ruling).
  await checkReliably(connectors.getByRole("checkbox", { name: /Write/ }));
  await connectors.getByRole("button", { name: "Generate connect link" }).click();

  // Scoped to the <code> element specifically, not a bare getByText(/\/connect\//)
  // -- the "Suggested message" paragraph right below it (components/settings/
  // connector-settings.tsx) also embeds the same connect URL inline in its own
  // sentence, so an unscoped text match resolves to both and is a strict-mode
  // violation (E2E-01).
  const connectLinkCode = connectors.locator("code", { hasText: "/connect/" });
  await expect(connectLinkCode).toBeVisible();
  await expect(connectors.getByText(/single use, expires in 10 minutes/i)).toBeVisible();

  const linkText = await connectLinkCode.innerText();
  expect(linkText, "the connect URL is absolute (real origin), not a bare path").toMatch(/^https?:\/\/.+\/connect\/[A-Za-z0-9_-]+$/);

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `document scrollWidth (${scrollWidth}) exceeds clientWidth (${clientWidth}) at 390px with a generated connect link present`).toBeLessThanOrEqual(clientWidth + 1);
});
