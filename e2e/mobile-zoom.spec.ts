import { test, expect, type Page } from "@playwright/test";
import { dismissCheckinDialogIfPresent } from "./helpers";

/**
 * Pinch-zoom behaviour on mobile (2026-08-27 batch). Ayman's request, in his
 * own words: "you can keep zooming in and out on two touch pinc, but not
 * exceeding the bounds of the app when it comes to zooming out, you can only
 * zoom out to default view, and when zooming in our out the bottom menu
 * should ALWAYS remain in the same place with the same size."
 *
 * Three claims, all of which need a REAL browser zoom to check:
 *   1. pinch-in still works (never disable it — it's also WCAG 1.4.4),
 *   2. pinch-out floors at scale 1 (app/layout.tsx's `minimumScale`),
 *   3. the bottom nav holds its on-screen position and size at any scale
 *      (components/shell/use-pin-to-visual-viewport.ts).
 *
 * `window.visualViewport.scale` is read-only and driven by the browser's
 * compositor: synthetic touch/pointer events do not move it, so this cannot
 * be tested from page script, and jsdom has no visual viewport at all. The
 * engineer who built it correctly reported the gesture as unverifiable with
 * the tools they had. It IS reachable through CDP — `Input.synthesizePinchGesture`
 * drives the real compositor — which is what this spec uses.
 *
 * The assertion that matters is on the nav's DEVICE-SCREEN rect, not its
 * layout rect. Those two are the same thing only at scale 1, and the whole
 * bug being guarded here is that `position: fixed` tracks the layout
 * viewport while the user sees the visual one. Measured at rest and again
 * while zoomed, the device rect must be unchanged — that is precisely "same
 * place, same size."
 *
 * Chromium-only by construction (CDP). Read-only: navigates and zooms,
 * writes nothing, so it needs no teardown.
 */

const PINCH_ORIGIN = { x: 195, y: 400 };

type ViewportReading = {
  scale: number;
  devLeft: number;
  devTop: number;
  devW: number;
  devH: number;
};

/** The nav's rect in DEVICE-SCREEN space: (layout rect − visual offset) × scale. */
async function readNav(page: Page, label: string): Promise<ViewportReading> {
  const reading = await page.evaluate(() => {
    const nav = document
      .querySelector('[data-testid="mobile-island-item-home"]')!
      .closest("nav") as HTMLElement;
    const box = nav.getBoundingClientRect();
    const vv = window.visualViewport!;
    return {
      scale: Number(vv.scale.toFixed(3)),
      devLeft: Math.round((box.left - vv.offsetLeft) * vv.scale),
      devTop: Math.round((box.top - vv.offsetTop) * vv.scale),
      devW: Math.round(box.width * vv.scale),
      devH: Math.round(box.height * vv.scale),
    };
  });
  // Kept as a log line rather than dropped: when this spec fails, the three
  // readings side by side are the whole diagnosis.
  console.log(`[mobile-zoom] ${label}: ${JSON.stringify(reading)}`);
  return reading;
}

test.describe("Mobile pinch-zoom", () => {
  test("zoom-in works, zoom-out floors at default, and the bottom nav never moves or resizes", async ({
    page,
    context,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== "chromium", "Input.synthesizePinchGesture is a CDP-only command");
    test.skip(
      testInfo.project.name !== "Mobile Chrome",
      "the bottom nav is lg:hidden — only the mobile project renders it"
    );

    await page.goto("/");
    await dismissCheckinDialogIfPresent(page);
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="mobile-island-item-home"]')).toBeVisible();

    const atRest = await readNav(page, "at rest");
    expect(atRest.scale, "the page should start unzoomed").toBeCloseTo(1, 1);

    const cdp = await context.newCDPSession(page);

    // --- Pinch IN: must actually zoom (never disable it) ---
    await cdp.send("Input.synthesizePinchGesture", {
      ...PINCH_ORIGIN,
      scaleFactor: 2,
      relativeSpeed: 800,
      gestureSourceType: "touch",
    });
    await page.waitForTimeout(800);
    const zoomedIn = await readNav(page, "pinched in");
    expect(zoomedIn.scale, "pinch-in must still zoom — userScalable:false would fail here").toBeGreaterThan(1.3);

    // --- ...and the nav must be exactly where it was, at the same size ---
    // 3px tolerance for subpixel compositing, not for drift: the failure this
    // guards produced a nav scaled 2x and pushed off the bottom of the screen.
    expect(Math.abs(zoomedIn.devTop - atRest.devTop), "nav moved vertically on screen").toBeLessThanOrEqual(3);
    expect(Math.abs(zoomedIn.devLeft - atRest.devLeft), "nav moved horizontally on screen").toBeLessThanOrEqual(3);
    expect(Math.abs(zoomedIn.devW - atRest.devW), "nav changed width on screen").toBeLessThanOrEqual(3);
    expect(Math.abs(zoomedIn.devH - atRest.devH), "nav changed height on screen").toBeLessThanOrEqual(3);

    // --- Pinch OUT hard: must floor at 1, never below ---
    await cdp.send("Input.synthesizePinchGesture", {
      ...PINCH_ORIGIN,
      scaleFactor: 0.2,
      relativeSpeed: 800,
      gestureSourceType: "touch",
    });
    await page.waitForTimeout(800);
    const zoomedOut = await readNav(page, "pinched out");
    expect(zoomedOut.scale, "zoom-out must floor at the default view (minimumScale: 1)").toBeGreaterThanOrEqual(0.99);

    // Back at rest, the nav is back on its own CSS position — the hook must
    // clear its transform rather than leave a stale one behind.
    expect(Math.abs(zoomedOut.devTop - atRest.devTop), "nav did not return to its resting position").toBeLessThanOrEqual(3);
    expect(Math.abs(zoomedOut.devH - atRest.devH), "nav did not return to its resting size").toBeLessThanOrEqual(3);
  });
});
