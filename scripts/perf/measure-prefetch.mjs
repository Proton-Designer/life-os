#!/usr/bin/env node
// The regression test docs/superpowers/specs/2026-08-18-navigation-prefetch-fix.md
// needed and didn't have: after Part A added `prefetch` to every cross-screen
// <Link>, does a warm nav click actually cost zero network requests, or does
// it silently fall back to a cold fetch the way the default `prefetch` did
// (root cause of that whole spec — dynamic routes with no loading.js boundary
// prefetch nothing under the default, and every route here is dynamic)?
//
// Requires a `next start` production server already running — see README.md.
// Usage: BASE_URL=http://localhost:3100 node scripts/perf/measure-prefetch.mjs
//
// --- Why this does NOT use the `next-router-prefetch: 1` request header ---
// An earlier version of this script's spec said to key off that header. It's
// wrong, and it's the kind of wrong that runs clean and produces a confident,
// false result — worth spelling out so nobody reaches for it again later.
//
// Per node_modules/next/dist/client/components/segment-cache/cache.js, that
// header is only set for FetchStrategy.PPRRuntime / RuntimeShell /
// LoadingBoundary. For FetchStrategy.Full — exactly what `prefetch={true}`
// selects (see link.js's prefetchIntent mapping), and what every cross-screen
// <Link> in this app has used since Part A — the switch sets no header at
// all. A Full-strategy prefetch request is wire-identical to a real
// navigation fetch: same `rsc: 1`, no marker, nothing to tell them apart by
// inspecting the request itself. After Part A, Full-strategy prefetches are
// the majority of what this app issues, so a header-based harness would
// misreport nearly every one of them as a click-triggered cache miss.
//
// So this keys off TIMING instead: the request listener for a route is only
// attached immediately before that route's measured click (never before),
// so anything the background prefetch already sent during the preceding
// settle window was never listened for and can't be miscounted — only
// requests that fire from the click onward are ever recorded. 3000ms of
// settle before each measured click matched what the joint Engineer
// 1/Engineer 2 re-measure found clean (README's "background prefetch can
// race an immediate revisit" trap, same mechanism, bigger margin here
// because this script wants zero ambiguity, not just an unflaky reading).
import { loginSession, ROUTES, BASE_URL, dismissCheckinDialogIfPresent } from "./lib/session.mjs";

const SETTLE_MS = 3000;
const POST_CLICK_GRACE_MS = 500; // window after "new screen visible" during which a real navigation fetch would still land

// components/shell/page-header.tsx renders a real <h1>{title}</h1> on every
// route — the one DOM signal common to all 9 pages, so "click → new screen"
// can be timed as click → this heading visible, rather than a fixed sleep
// (a fixed sleep would report ~POST_CLICK_GRACE_MS on every route regardless
// of how fast the paint actually was, which is not a measurement).
const ROUTE_HEADING = {
  "/": "Home",
  "/deen": "Deen",
  "/business": "Business",
  "/fitness": "Fitness",
  "/school": "School",
  "/co-op": "Co-op",
  "/insights": "Insights",
  "/weekly-planning": "Weekly Planning",
  "/settings": "Settings",
};

async function settleThenClick(page, route) {
  await dismissCheckinDialogIfPresent(page);
  await page.waitForTimeout(SETTLE_MS);

  const postClickRequests = [];
  const onRequest = async (req) => {
    try {
      const headers = await req.allHeaders();
      if (headers["rsc"] === "1" && req.url().split("?")[0] === `${BASE_URL}${route}`) {
        postClickRequests.push(req.url());
      }
    } catch {
      // request object recycled before headers resolved; not interesting either way
    }
  };
  // Attached right before the click, not before the settle above — a
  // prefetch that already landed during the settle window was never
  // listened for, so it cannot be double-counted as a post-click request.
  page.on("request", onRequest);

  const link = page.locator(`a[href="${route}"]:visible`).first();
  const start = performance.now();
  await link.click();
  await page
    .getByRole("heading", { level: 1, name: ROUTE_HEADING[route] })
    .waitFor({ state: "visible", timeout: 5000 });
  const elapsedMs = performance.now() - start;
  // A real navigation fetch (cache miss) can still be in flight for a beat
  // after the heading paints — give it room to land before the listener is
  // removed, so a miss is never undercounted just because we stopped
  // listening too early.
  await page.waitForTimeout(POST_CLICK_GRACE_MS);

  page.off("request", onRequest);
  return { route, nonPrefetchRequestCount: postClickRequests.length, elapsedMs };
}

async function main() {
  const { browser, page } = await loginSession({ headless: true });
  await page.setViewportSize({ width: 1600, height: 1000 });

  // Visit every route once first (unmeasured) so each one's own nav links get
  // a chance to prefetch before it's ever a measured click target — mirrors
  // how the app is actually used (every route reachable from the persistent
  // nav, not a single linear cold tour).
  const order = [...ROUTES.slice(1), ROUTES[0]]; // skip Home (already there post-login), end back at Home
  for (const route of order) {
    await dismissCheckinDialogIfPresent(page);
    await page.locator(`a[href="${route}"]:visible`).first().click();
    await page.waitForTimeout(200);
  }

  // Now the measured pass: from wherever the warm-up left off (Home), click
  // through all 9 routes again, settling 3000ms before each click.
  const results = [];
  for (const route of order) {
    results.push(await settleThenClick(page, route));
  }

  await browser.close();

  console.log(`\nWarm nav clicks, ${SETTLE_MS}ms settle before each, all ${order.length} routes:`);
  console.table(
    results.map((r) => ({
      route: r.route,
      "non-prefetch rsc reqs": r.nonPrefetchRequestCount,
      "elapsed ms": r.elapsedMs.toFixed(0),
    }))
  );

  const misses = results.filter((r) => r.nonPrefetchRequestCount > 0);
  if (misses.length) {
    console.error(
      `\nCACHE MISS on warm click: ${misses.map((r) => `${r.route} (${r.nonPrefetchRequestCount} req)`).join(", ")}`
    );
    process.exitCode = 1;
  } else {
    console.log("\nAll warm clicks: 0 non-prefetch RSC requests.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
