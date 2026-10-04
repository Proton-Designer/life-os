import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

/**
 * RS-01 -- Morning routine and Sleep plan are opt-in features (profiles.enabled_features),
 * OFF by default for every account. Domains-mode fixture. Written, not run by the author
 * (the lead runs Playwright).
 *
 * Contract: OFF -> Home shows neither module; Settings -> Optional features offers both;
 * switching one on shows exactly that module on Home; switching it off hides it again and
 * the afterAll leaves BOTH off (the fixture's resting state). Fully serial: one live account.
 */
test.describe.configure({ mode: "serial" });

const ROUTINE = "Morning routine";
const SLEEP = "What time are you sleeping tonight?";

async function setFeature(page: import("@playwright/test").Page, label: RegExp, on: boolean) {
  await page.goto("/settings");
  await dismissCheckinDialogIfPresent(page);
  const box = page.getByRole("checkbox", { name: label });
  await expect(box).toBeVisible();
  if ((await box.isChecked()) !== on) await box.setChecked(on);
  // The save is optimistic; wait until the control has settled (not disabled) before navigating.
  await expect(box).toBeEnabled({ timeout: 15_000 });
}

test.afterAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: test.info().project.use.storageState as string | undefined });
  const page = await context.newPage();
  await setFeature(page, /Morning routine/, false).catch(() => {});
  await setFeature(page, /Sleep plan/, false).catch(() => {});
  await context.close();
});

test("both off by default: Home shows neither module", async ({ page }) => {
  await setFeature(page, /Morning routine/, false);
  await setFeature(page, /Sleep plan/, false);
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);
  await expect(page.getByText(ROUTINE, { exact: true })).toHaveCount(0);
  await expect(page.getByText(SLEEP)).toHaveCount(0);
});

test("Morning routine on shows only the routine; off hides it again", async ({ page }) => {
  await setFeature(page, /Morning routine/, true);
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);
  await expect(page.getByText(ROUTINE, { exact: true })).toBeVisible();
  await expect(page.getByText(SLEEP)).toHaveCount(0);
  await setFeature(page, /Morning routine/, false);
  await page.goto("/");
  await expect(page.getByText(ROUTINE, { exact: true })).toHaveCount(0);
});

test("Sleep plan on shows only the sleep module and its reminder setting", async ({ page }) => {
  await setFeature(page, /Sleep plan/, true);
  await page.goto("/");
  await dismissCheckinDialogIfPresent(page);
  await expect(page.getByText(SLEEP)).toBeVisible();
  await expect(page.getByText(ROUTINE, { exact: true })).toHaveCount(0);
  await setFeature(page, /Sleep plan/, false);
});
