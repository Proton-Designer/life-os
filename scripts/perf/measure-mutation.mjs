#!/usr/bin/env node
// Regression test for the actual root cause in
// docs/superpowers/specs/2026-08-16-navigation-latency-fix.md: a Server
// Action mutation on one route still purges the ENTIRE client Router Cache
// via revalidatePath, including routes it never named — that's deliberate
// (see the spec's "Which primitive purges what" table and its "Rejected:
// removing revalidatePath" section), because it's what guarantees you never
// see a stale number. This harness proves two things at once: (1) that
// broad-purge behavior is still real (RSC requests > 0 on an untouched
// route revisited right after the mutation), and (2) that Phase 1/2's fix
// means that purge no longer shows a skeleton or blanks the screen.
//
// Navigation must go through real <Link> clicks, not page.goto() — a
// page.goto() is a hard/top-level navigation that always does a fresh
// document request and never carries the `RSC: 1` header, so it can't
// observe client Router Cache behavior at all (caught by testing this
// script: page.goto() reported 0 RSC requests on routes regardless of
// purge state, which was measuring nothing rather than confirming a fix).
//
// Mutates today's Isha prayer status on the real SEED account, then
// restores it exactly as found — reuses the same reversible pattern as
// e2e/deen.spec.ts (capture prior status, mark on-time, restore via the
// same button, or via the test-only DELETE /api/test/clear-prayer route if
// it was genuinely unlogged). SEED account only. Checks the cleanup
// response status explicitly — a silent cleanup failure has left a stray
// row before. Requires a `next start` production server already running —
// see README.md.
//
// Usage: BASE_URL=http://localhost:3100 node scripts/perf/measure-mutation.mjs
import { loginSession, BASE_URL, requireEnv, dismissCheckinDialogIfPresent } from "./lib/session.mjs";

const STATUS_LABELS = ["On-time", "Qada", "Missed"];
const UNTOUCHED_ROUTES = ["/fitness", "/school"];
const WARM_ROUTES = ["/deen", "/business", "/fitness", "/school"]; // already on "/" post-login
const SETTLE_MS = 2500; // matches the navigation-prefetch-fix acceptance criterion's "~2.5s settle"

// Same technique as measure-prefetch.mjs: components/shell/page-header.tsx
// renders a real <h1>{title}</h1> on every route, so click -> new screen can
// be timed as click -> that heading visible.
const ROUTE_HEADING = { "/fitness": "Fitness", "/school": "School" };

async function clickLinkAndProbe(page, route) {
  await dismissCheckinDialogIfPresent(page);
  const rscRequests = [];
  const onRequest = async (req) => {
    try {
      const headers = await req.allHeaders();
      if (headers["rsc"] === "1" && req.url().split("?")[0] === `${BASE_URL}${route}`) {
        rscRequests.push(req.url());
      }
    } catch {
      // ignore recycled request objects
    }
  };
  page.on("request", onRequest);
  const start = performance.now();
  await page.locator(`a[href="${route}"]:visible`).first().click();
  const heading = ROUTE_HEADING[route];
  let elapsedMs = null;
  if (heading) {
    await page.getByRole("heading", { level: 1, name: heading }).waitFor({ state: "visible", timeout: 5000 });
    elapsedMs = performance.now() - start;
  }
  await page.waitForTimeout(400); // give a real server round trip (200-450ms per measure-server-time.mjs) room to land
  page.off("request", onRequest);
  const skeletonSeen = await page.evaluate(() => !!document.querySelector('[data-slot="skeleton"]'));
  return { route, rscRequestCount: rscRequests.length, skeletonSeen, elapsedMs };
}

async function main() {
  const { browser, page, context } = await loginSession({ headless: true });
  await page.setViewportSize({ width: 1600, height: 1000 });

  for (const route of WARM_ROUTES) {
    await clickLinkAndProbe(page, route);
  }

  await dismissCheckinDialogIfPresent(page);
  await page.locator(`a[href="/deen"]:visible`).first().click();
  await dismissCheckinDialogIfPresent(page);
  // Scoped to the row with the status buttons, not just text match — the
  // qada backlog (bfee70b) added "Isha · Aug 10" / "Isha · Aug 12" list items
  // to this same page, so a bare `hasText: "Isha"` resolves to 3 elements and
  // Playwright throws in strict mode.
  const prayerRow = page
    .locator("li", { hasText: "Isha" })
    .filter({ has: page.getByRole("button", { name: "On-time" }) })
    .first();
  await prayerRow.waitFor();

  let priorStatusLabel = null;
  for (const label of STATUS_LABELS) {
    const isActive = await prayerRow
      .getByRole("button", { name: label })
      .locator("span")
      .evaluate((el) => !el.className.includes("bg-muted"));
    if (isActive) {
      priorStatusLabel = label;
      break;
    }
  }

  await prayerRow.getByRole("button", { name: "On-time" }).click();
  await page.waitForTimeout(400); // let the Server Action + revalidatePath land

  const immediateResults = [];
  for (const route of UNTOUCHED_ROUTES) {
    immediateResults.push(await clickLinkAndProbe(page, route));
    // Each probe leaves us on `route`; go back to /deen so the next probe's
    // click is a fair same-origin nav, matching WARM_ROUTES's starting point.
    await dismissCheckinDialogIfPresent(page);
    await page.locator(`a[href="/deen"]:visible`).first().click();
  }

  // Acceptance criterion 3: "Post-mutation, after a ~2.5s settle: 0
  // requests, comparable timing." Re-probe the same routes after Next has
  // had time to re-prefetch the in-viewport links post-purge.
  await page.waitForTimeout(SETTLE_MS);
  const settledResults = [];
  for (const route of UNTOUCHED_ROUTES) {
    settledResults.push(await clickLinkAndProbe(page, route));
    await dismissCheckinDialogIfPresent(page);
    await page.locator(`a[href="/deen"]:visible`).first().click();
  }

  // Cleanup — restore the account to exactly what it was before this ran.
  // Already on /deen (the last probe loop's own return click above).
  let cleanupOk = false;
  await dismissCheckinDialogIfPresent(page);
  const rowAfter = page
    .locator("li", { hasText: "Isha" })
    .filter({ has: page.getByRole("button", { name: "On-time" }) })
    .first();
  await rowAfter.waitFor();
  if (priorStatusLabel) {
    await rowAfter.getByRole("button", { name: priorStatusLabel }).click();
    await page.waitForTimeout(300);
    cleanupOk = await rowAfter
      .getByRole("button", { name: priorStatusLabel })
      .locator("span")
      .evaluate((el) => !el.className.includes("bg-muted"));
  } else {
    const secret = requireEnv("E2E_TEST_SECRET");
    const cookies = await context.cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await fetch(`${BASE_URL}/api/test/clear-prayer`, {
      method: "DELETE",
      headers: { Cookie: cookieHeader, "x-e2e-secret": secret, "Content-Type": "application/json" },
      body: JSON.stringify({ prayerName: "isha" }),
    });
    cleanupOk = res.status === 200;
    if (!cleanupOk) {
      console.error(`Cleanup DELETE /api/test/clear-prayer returned ${res.status}: ${await res.text()}`);
    }
  }

  await browser.close();

  const fmt = (r) => ({
    route: r.route,
    "rsc reqs": r.rscRequestCount,
    skeleton: r.skeletonSeen,
    "elapsed ms": r.elapsedMs === null ? "n/a" : r.elapsedMs.toFixed(0),
  });

  console.log(`\nMutation: marked Isha on-time via the real UI + Server Action (markPrayer -> revalidatePath).`);
  console.log(`Prior status: ${priorStatusLabel ?? "pending (unlogged)"}\n`);
  console.log("Untouched routes, revisited via real <Link> click immediately after (never named by the mutation):");
  console.table(immediateResults.map(fmt));
  console.log(`\nSame routes, revisited after a ${SETTLE_MS}ms settle (acceptance criterion 3):`);
  console.table(settledResults.map(fmt));
  console.log(`\nCleanup: ${cleanupOk ? "OK — real account restored" : "FAILED — real account may be left mutated, check manually"}`);

  const allResults = [...immediateResults, ...settledResults];
  const skeletonLeaked = allResults.filter((r) => r.skeletonSeen);
  const purgeNotObserved = immediateResults.filter((r) => r.rscRequestCount === 0);
  if (skeletonLeaked.length) {
    console.error(`\nCONTRACT VIOLATION — skeleton appeared on: ${skeletonLeaked.map((r) => r.route).join(", ")}`);
    process.exitCode = 1;
  }
  if (purgeNotObserved.length) {
    console.log(
      `\nNote: no RSC request observed immediately post-mutation on ${purgeNotObserved.map((r) => r.route).join(", ")} — either the broad-purge behavior has narrowed since the spec was written (worth telling the lead), or something else refetched it. Not automatically a defect.`
    );
  }
  if (!cleanupOk) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
