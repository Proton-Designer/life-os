import { test, expect } from "@playwright/test";
import { dismissCheckinDialogIfPresent, settleRoute } from "./helpers";

// Part of the 2026-08-15 structural refactor's Phase A quality floor: "zero
// horizontal overflow at 390/768/1024/1280/1600px, measured via scrollWidth
// vs clientWidth, never eyeballed" — see
// docs/superpowers/specs/2026-08-15-frontend-structural-refactor.md.
// Runs once (Desktop Chrome only — it carries the authenticated storageState
// and this spec overrides its own viewport per test anyway, so running it a
// second time under Mobile Chrome's project would just duplicate coverage).
// 320 added 2026-08-26 (night batch 3): the mobile island went from 5 to 7
// targets when Fitness and Work were promoted out of its "..." menu, and the
// only evidence it still fit was arithmetic (~306px calculated). The /school
// incident earlier this week is the reason that isn't good enough — the grid
// math there looked fine while the column actually resolved to 417px. 320 is
// the narrowest viewport still in real use, and it is where a 7-item pill
// breaks first if it breaks at all.
const BREAKPOINTS = [320, 390, 768, 1024, 1280, 1600];

const AUTHED_ROUTES = [
  "/",
  "/deen",
  "/business",
  "/fitness",
  "/school",
  "/work",
  "/insights",
  "/settings",
  "/onboarding",
];

const PUBLIC_ROUTES = ["/login", "/signup"];

// Opus Lead review (2026-08-26, after TWO engineers independently got a
// false pass from this exact spec the same afternoon): `waitForSettled`'s
// networkidle+fonts+2rAF settle point is a TIMING proxy for "the widest
// element has mounted," not a guarantee of it — a Server Component response
// that's still assembling when networkidle fires (page compiling under
// load, a slow query, etc.) measures a genuinely-empty layout and passes in
// ~3s, which the poll then has no way to distinguish from a real pass. Only
// a CONTENT assertion can tell "nothing wide has rendered yet" apart from
// "nothing wide exists on this page." Routes whose principal (widest) content
// isn't guaranteed present by settle time alone get an explicit selector
// here; the test waits for it before ever measuring. Not every route needs
// one — most content is layout-stable structural chrome, not variable-width
// data render — so this stays an opt-in map, not a blanket wait.
const READY_SELECTOR: Partial<Record<string, string>> = {
  "/school": '[data-testid="class-cards-grid"]',
};

// Opus Lead review (2026-08-16): a bare goto->measure had no deterministic
// settle point. `goto` resolves on `load`, but a streaming Server Component,
// a late font swap, or a client chart mounting can all still move layout
// after that — under full-suite load (slower machine) the measurement can
// land mid-shift, which cuts both ways: a transient overflow reads as a
// false FAIL, or measuring BEFORE a wide element has mounted yet reads as a
// false PASS on a page that will actually overflow once settled. The false
// PASS is the dangerous direction, since nothing would ever flag it.
// Fix: wait for network idle + web fonts + two animation frames (hydration/
// layout settle) BEFORE measuring at all, so the measurement itself isn't
// racing anything. expect.poll then gives any final micro-jitter a short
// window to resolve without masking a real, persistent overflow (which
// stays failing across the whole poll window regardless).
async function waitForSettled(page: import("@playwright/test").Page, route?: string) {
  // Batch 5's loading.tsx sweep gave every route a real Suspense boundary.
  // networkidle alone is not a reliable proxy for "the skeleton is gone" —
  // a streamed response with a gap of >500ms between chunks (a slow query
  // mid-stream) can go network-idle while the fallback is still what's
  // painted, which is exactly the false-pass shape this spec's own header
  // comment already warns about for content in general. Checked first and
  // unconditionally (not just for /school's READY_SELECTOR entry), since
  // every route in AUTHED_ROUTES now carries a loading.tsx.
  await settleRoute(page);
  // networkidle is belt-and-braces here, NOT the gate — the READY_SELECTOR
  // content assertion below is what actually rules out a false pass, per this
  // file's own reasoning. And it cannot reliably settle: RealtimeSyncProvider
  // holds a live subscription, and Home/Insights poll, so "500ms of network
  // silence" may simply never occur. Letting it throw turns a settling
  // heuristic into a failure that looks exactly like a layout regression —
  // observed on /work and /insights, where the layout was fine. Bounded and
  // swallowed: if it settles we get a slightly steadier measurement, and if it
  // doesn't the content check still has to pass.
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );
  // The content check that actually rules out the false pass: assert the
  // route's own widest content is in the DOM, not just that the network
  // and paint have gone quiet. Real timeout (Playwright's default), not
  // swallowed — a route whose ready selector never appears is a genuine
  // failure (the page broke), not something to silently skip past.
  const readySelector = route ? READY_SELECTOR[route] : undefined;
  if (readySelector) {
    await page.locator(readySelector).first().waitFor({ state: "attached" });
  }
}

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page, width: number) {
  await expect
    .poll(
      async () => {
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        // 1px tolerance for subpixel rounding, same margin the spec's own
        // "measured, not eyeballed" quality floor implies is acceptable.
        return scrollWidth <= clientWidth + 1;
      },
      {
        message: `document scrollWidth exceeds clientWidth at ${width}px wide`,
        timeout: 2000,
      }
    )
    .toBe(true);
}

// document.documentElement.scrollWidth only catches page-level overflow — an
// inner container overflowing its own parent under an `overflow-hidden`
// ancestor gets silently clipped instead, which the document-level check
// can't see. Charts inside Panels (Phase C onward) are exactly that risk,
// per the Phase B review. Every Panel carries `data-panel` for this reason.
/**
 * CRUSHED text, which is a different instrument from overflow (R48).
 *
 * Found 2026-09-02 capturing R7 evidence: School's grade-ledger dialog renders
 * the Name column as `Midter…` at 390px while the identical string renders in
 * full 400px lower in the same dialog — box 56px, needs 229px. Roughly a
 * quarter of the title is visible.
 *
 * NEITHER existing assertion sees it. `assertNoHorizontalOverflow` measures the
 * document, and a clipped cell overflows nothing — it is clipped precisely so
 * it doesn't. `assertNoPanelOverflow` measures `[data-panel]` bounds, same
 * reason. A column-overlap check (boxes intersecting) also reports clean,
 * because the columns never intersect; one is simply too narrow. That check was
 * written for this exact bug and passed twice.
 *
 * THRESHOLD, stated because it is a judgment and not a law: this flags text
 * showing LESS THAN HALF its content, which is "crushed", not "truncated". A
 * deliberate ellipsis on a long user-supplied title usually shows most of it and
 * is a legitimate design choice; 24% is a column-sizing bug. Tightening the
 * ratio makes this noisier, not stricter — if it starts flagging real
 * ellipses, fix the ratio, do not add an allowlist. An allowlist here is a
 * mute button on the only check that can see this class of defect.
 */
async function assertNoCrushedText(page: import("@playwright/test").Page, width: number, scope = "body") {
  const crushed = await page.evaluate(
    ({ scope }) => {
      const root = document.querySelector(scope) ?? document.body;
      const out: { text: string; box: number; needs: number }[] = [];
      for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
        if (el.children.length > 0) continue; // leaf text nodes only
        const text = (el.textContent ?? "").trim();
        if (text.length < 8) continue; // short labels legitimately abbreviate
        const box = el.clientWidth;
        const needs = el.scrollWidth;
        if (box > 0 && needs > box * 2) out.push({ text: text.slice(0, 40), box, needs });
      }
      return out;
    },
    { scope }
  );
  expect(
    crushed,
    `text crushed to under half its width at ${width}px: ${JSON.stringify(crushed)}`
  ).toEqual([]);
}

async function assertNoPanelOverflow(page: import("@playwright/test").Page, width: number) {
  await expect
    .poll(
      async () => {
        const overflowing = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>("[data-panel]"))
            .map((el, i) => ({ i, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
            .filter((p) => p.scrollWidth > p.clientWidth + 1)
        );
        return overflowing.length;
      },
      {
        message: `panel(s) overflow their own bounds at ${width}px wide`,
        timeout: 2000,
      }
    )
    .toBe(0);
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
        await waitForSettled(page, route);
        await assertNoHorizontalOverflow(page, width);
        await assertNoPanelOverflow(page, width);
      }
    });
  }

  // 2026-08-26: the class-detail dialog shipped its own overflow bug (the
  // same missing-base-grid-cols-1 idiom found in /school, fixed the same
  // afternoon) that this spec could never have caught — page-load overflow
  // checks are blind to content that only exists once a dialog is opened.
  // This batch is specifically about that dialog, so it gets its own
  // coverage rather than staying a page-load-only spec.
  test("the expanded class view dialog has no horizontal overflow at any breakpoint", async ({ page }) => {
    for (const width of BREAKPOINTS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/school");
      await dismissCheckinDialogIfPresent(page);
      await waitForSettled(page, "/school");

      // Any class card's View button opens the same dialog component —
      // the first one is enough to exercise the layout.
      await page.getByRole("button", { name: /^View / }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await waitForSettled(page);

      await assertNoHorizontalOverflow(page, width);
      await assertNoPanelOverflow(page, width);
      await assertNoCrushedText(page, width, '[role="dialog"]');
    }
  });

  for (const route of PUBLIC_ROUTES) {
    test(`${route} has no horizontal overflow at any breakpoint`, async ({ page }) => {
      for (const width of BREAKPOINTS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        await waitForSettled(page);
        await assertNoHorizontalOverflow(page, width);
        await assertNoPanelOverflow(page, width);
      }
    });
  }
});
