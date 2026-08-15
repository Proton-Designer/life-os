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
  // The Phase B/C component harness — the only route with real [data-panel]
  // elements today (Panel isn't wired into any real page until D-G), so
  // this is what actually exercises the per-panel check below right now.
  // Dev-only (404s in production), safe to include here.
  "/harness",
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

// document.documentElement.scrollWidth only catches page-level overflow — an
// inner container overflowing its own parent under an `overflow-hidden`
// ancestor gets silently clipped instead, which the document-level check
// can't see. Charts inside Panels (Phase C onward) are exactly that risk,
// per the Phase B review. Every Panel carries `data-panel` for this reason.
async function assertNoPanelOverflow(page: import("@playwright/test").Page, width: number) {
  const overflowing = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-panel]"))
      .map((el, i) => ({ i, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
      .filter((p) => p.scrollWidth > p.clientWidth + 1)
  );
  expect(overflowing, `${overflowing.length} panel(s) overflow their own bounds at ${width}px wide`).toEqual([]);
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
        await assertNoPanelOverflow(page, width);
      }
    });
  }

  for (const route of PUBLIC_ROUTES) {
    test(`${route} has no horizontal overflow at any breakpoint`, async ({ page }) => {
      for (const width of BREAKPOINTS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        await assertNoHorizontalOverflow(page, width);
        await assertNoPanelOverflow(page, width);
      }
    });
  }
});
