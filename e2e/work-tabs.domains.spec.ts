import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

/**
 * WORK-W1 -- the Work screen's tabs, end to end, on the DOMAINS-mode fixture
 * (seed-domains@lifeos.test; "Domains Fixture" project, so *.domains.spec.ts). WRITTEN, NOT RUN
 * by eng2 (lead runs Playwright).
 *
 * Contract: a Business tab can be added from "Edit tabs" (idempotent), it renders the Business
 * screen, tabs can be renamed and reordered, the first tab is the default, /business redirects to
 * the Business tab, and the SYSTEM nav no longer shows a separate Business link.
 *
 * FIXTURE ASSUMPTION (unverified until the first run): the fixture has a `work` user_domains row
 * with at least one active tab.
 * STATE DISCIPLINE: afterAll archives the Business tab again (Remove -> Save; archived, never
 * deleted; ensureBusinessWorkTab un-archives it on the next run) and restores the label.
 */
test.describe.configure({ mode: "serial" });

async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/work");
  await dismissCheckinDialogIfPresent(page);
  await page.getByTestId("edit-work-tabs-trigger").click();
  await expect(page.getByTestId("edit-work-tabs-list")).toBeVisible();
}

test("adds a Business tab, which opens the Business screen and is first in the bar", async ({ page }) => {
  await openEditor(page);
  if (await page.getByTestId("add-business-tab").count()) {
    await page.getByTestId("add-business-tab").click();
  } else {
    await page.keyboard.press("Escape");
  }
  await page.goto("/work");
  await expect(page).toHaveURL(/\/work\/[^/]+$/);
  const tabs = page.locator('[data-testid^="work-subdomain-tab-"]');
  await expect(tabs.first()).toContainText("Business");
});

test("renaming a tab updates the bar at once and survives a reload", async ({ page }) => {
  await openEditor(page);
  const name = page.getByLabel("Name of tab 1");
  await name.fill("Studio");
  await page.getByTestId("edit-work-tabs-save").click();
  await expect(page.locator('[data-testid^="work-subdomain-tab-"]').first()).toContainText("Studio");
  await page.reload();
  await expect(page.locator('[data-testid^="work-subdomain-tab-"]').first()).toContainText("Studio");
});

test("the first tab is the default for /work and /business redirects to the Business tab", async ({ page }) => {
  await page.goto("/work");
  await expect(page).toHaveURL(/\/work\/[^/]+$/);
  await page.goto("/business");
  await expect(page).toHaveURL(/\/work\/[^/]+$/);
});

test("the SYSTEM nav has no separate Business link while a Business tab exists", async ({ page }) => {
  await page.goto("/work");
  await dismissCheckinDialogIfPresent(page);
  await expect(page.getByRole("link", { name: /^business$/i })).toHaveCount(0);
});

test.afterAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: "playwright/.auth/seed-domains.json" })).newPage();
  await openEditor(page);
  await page.getByLabel("Name of tab 1").fill("Business");
  const remove = page.getByRole("button", { name: /^Remove Business$/ });
  if (await remove.count()) await remove.click();
  await page.getByTestId("edit-work-tabs-save").click();
  await page.close();
});
