#!/usr/bin/env node
// Verifies the user-visible contract of the 2026-08-16 nav-latency fix
// (docs/superpowers/specs/2026-08-16-navigation-latency-fix.md): clicking
// between routes must never blank the screen and must never show a
// full-screen skeleton — for a first-time-this-session visit (cold) or an
// immediate revisit (warm, expect a Router Cache hit). Drives real <Link>
// clicks in a signed-in desktop session. Mutates nothing. Requires a
// `next start` production server already running — see README.md.
//
// Usage: BASE_URL=http://localhost:3100 node scripts/perf/measure-navigation.mjs
import { loginSession, ROUTES, BASE_URL, dismissCheckinDialogIfPresent } from "./lib/session.mjs";

async function navigateAndProbe(page, route) {
  await dismissCheckinDialogIfPresent(page);
  await page.evaluate(() => {
    window.__navProbe = { skeletonSeen: false, minTextLen: Infinity };
    const check = () => {
      if (document.querySelector('[data-slot="skeleton"]')) window.__navProbe.skeletonSeen = true;
      const len = (document.body.innerText || "").trim().length;
      if (len < window.__navProbe.minTextLen) window.__navProbe.minTextLen = len;
    };
    window.__navProbeTimer = setInterval(check, 15);
    check();
  });

  const rscRequests = [];
  const onRequest = async (req) => {
    try {
      const headers = await req.allHeaders();
      if (headers["rsc"] === "1" && req.url().split("?")[0] === `${BASE_URL}${route}`) {
        rscRequests.push(req.url());
      }
    } catch {
      // request object can be recycled before headers resolve; not interesting either way
    }
  };
  page.on("request", onRequest);

  const link = page.locator(`a[href="${route}"]:visible`).first();
  const start = performance.now();
  // A cache hit produces no matching network response at all — waitForResponse
  // then times out by design (800ms is enough margin above the ~200-450ms
  // real server renders measure-server-time.mjs records). Report elapsed only
  // when a response was actually observed; a timed-out wait is not "how long
  // the navigation took," it's just the ceiling we gave up at, and reporting
  // it as elapsed would be a fabricated number.
  const respPromise = page
    .waitForResponse((r) => r.url().split("?")[0] === `${BASE_URL}${route}`, { timeout: 800 })
    .catch(() => null);
  await link.click();
  const response = await respPromise;
  await page.waitForTimeout(120); // settle buffer past the primary response for React commit/paint
  const elapsedMs = response ? performance.now() - start : null;

  page.off("request", onRequest);
  const probe = await page.evaluate(() => {
    clearInterval(window.__navProbeTimer);
    return window.__navProbe;
  });

  return {
    route,
    rscRequestCount: rscRequests.length,
    skeletonSeen: probe.skeletonSeen,
    wentBlank: probe.minTextLen === 0,
    elapsedMs,
  };
}

function fmt(r) {
  return {
    route: r.route,
    "rsc reqs": r.rscRequestCount,
    skeleton: r.skeletonSeen,
    "went blank": r.wentBlank,
    "elapsed ms": r.elapsedMs === null ? "cache hit" : r.elapsedMs.toFixed(0),
  };
}

async function main() {
  const { browser, page } = await loginSession({ headless: true });
  await page.setViewportSize({ width: 1600, height: 1000 });

  const order = [...ROUTES.slice(1), ROUTES[0]]; // skip Home (already there post-login), end back at Home

  const coldResults = [];
  for (const route of order) {
    coldResults.push(await navigateAndProbe(page, route));
  }

  // Immediate revisit — every route was just visited once this session, so
  // this pass should be a clean Router Cache hit: ~0 RSC requests, no
  // skeleton, no blank.
  const warmResults = [];
  for (const route of order) {
    warmResults.push(await navigateAndProbe(page, route));
  }

  await browser.close();

  console.log("\nCold pass (first visit this session):");
  console.table(coldResults.map(fmt));
  console.log("\nWarm pass (immediate revisit — expect cache hit, 0 RSC requests):");
  console.table(warmResults.map(fmt));

  const broken = [...coldResults, ...warmResults].filter((r) => r.skeletonSeen || r.wentBlank);
  if (broken.length) {
    console.error(`\nCONTRACT VIOLATION on: ${broken.map((r) => r.route).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
