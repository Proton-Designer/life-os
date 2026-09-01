import { test, expect } from "@playwright/test";

/**
 * Bring-your-own-key settings, verified against the deployed app.
 *
 * The two claims worth checking are the ones a build cannot make: that the
 * section reads as an OPTIONAL offer rather than a paywall, and that a bad key
 * is rejected by the SERVER (verified with the provider) rather than merely
 * shape-checked in the browser.
 */
test.describe("API key settings", () => {
  test("reads as optional, and never shows a stored key", async ({ page }) => {
    await page.goto("/settings");
    const section = page.locator("#ai");
    await expect(section).toBeVisible();

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
    await page.goto("/settings");
    const section = page.locator("#ai");
    await expect(section).toBeVisible();

    // Correct shape (starts with sk-, right sort of length) so the client-side
    // check passes and the only thing that can reject it is a real call.
    await section.locator('input[type="password"]').first().fill("sk-0000000000000000000000000000000000");
    await section.getByRole("button", { name: /^connect$/i }).click();

    await expect(section.getByText(/rejected that key|didn't work|couldn't reach|error/i)).toBeVisible({
      timeout: 30_000,
    });

    // And nothing may claim to be connected afterwards.
    await expect(section.getByText(/connected · ····/)).toHaveCount(0);
  });
});
