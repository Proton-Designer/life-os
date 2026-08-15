import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

// Part of the 2026-08-15 structural refactor's Phase A quality floor: "zero
// horizontal overflow at 390/768/1024/1280/1600px, measured via scrollWidth
// vs clientWidth, never eyeballed" — see
// docs/superpowers/specs/2026-08-15-frontend-structural-refactor.md.
// Runs once (Desktop Chrome only — it carries the authenticated storageState
// and this spec overrides its own viewport per test anyway, so running it a
// second time under Mobile Chrome's project would just duplicate coverage).
const BREAKPOINTS = [390, 768, 1024, 1280, 1600];

const AUTHED_ROUTES = [
  "/",
  "/deen",
  "/business",
  "/fitness",
  "/school",
  "/co-op",
  "/insights",
  "/weekly-planning",
  "/settings",
  "/onboarding",
];

const PUBLIC_ROUTES = ["/login", "/signup"];

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page, width: number) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  // 1px tolerance for subpixel rounding, same margin the spec's own
  // "measured, not eyeballed" quality floor implies is acceptable.
  expect(
    scrollWidth,
    `scrollWidth (${scrollWidth}) exceeds clientWidth (${clientWidth}) at ${width}px wide`
  ).toBeLessThanOrEqual(clientWidth + 1);
}

test.describe("Layout overflow — zero horizontal scroll at every breakpoint", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "Desktop Chrome", "runs once, viewport is overridden per test");
  });

  for (const route of AUTHED_ROUTES) {
    test(`${route || "/"} has no horizontal overflow at any breakpoint`, async ({ page }) => {
      for (const width of BREAKPOINTS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        await dismissCheckinDialogIfPresent(page);
        await assertNoHorizontalOverflow(page, width);
      }
    });
  }

  for (const route of PUBLIC_ROUTES) {
    test(`${route} has no horizontal overflow at any breakpoint`, async ({ page }) => {
      for (const width of BREAKPOINTS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        await assertNoHorizontalOverflow(page, width);
      }
    });
  }
});
