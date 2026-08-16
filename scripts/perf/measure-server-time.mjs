#!/usr/bin/env node
// Pure server render time, no browser paint mixed in. Signs in through the
// real /login form, then fetches each route's RSC payload directly with the
// resulting session cookies and the `RSC: 1` header (what Next's own <Link>
// prefetch/navigation fetches send) and times the server response only.
// Mutates nothing. Requires a `next start` production server already
// running — see README.md.
//
// Usage: BASE_URL=http://localhost:3100 node scripts/perf/measure-server-time.mjs
import { loginSession, ROUTES, median, BASE_URL } from "./lib/session.mjs";

const ITERATIONS = Number(process.env.ITERATIONS ?? 8); // first run per route is discarded as a warm-up

async function main() {
  const { browser, context } = await loginSession({ headless: true });
  const cookies = await context.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const results = [];
  for (const route of ROUTES) {
    const timings = [];
    let lastStatus = null;
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      const res = await fetch(`${BASE_URL}${route}`, {
        headers: { Cookie: cookieHeader, RSC: "1" },
      });
      await res.arrayBuffer();
      const elapsed = performance.now() - start;
      lastStatus = res.status;
      if (i > 0) timings.push(elapsed); // discard warm-up
    }
    results.push({ route, status: lastStatus, medianMs: median(timings), n: timings.length });
  }

  await browser.close();

  console.log(`\nServer render time — RSC fetch, median of ${ITERATIONS - 1} runs (1 warm-up discarded per route)`);
  console.log(`Base URL: ${BASE_URL}\n`);
  console.table(results.map((r) => ({ route: r.route, status: r.status, "median ms": r.medianMs.toFixed(1) })));

  const nonOk = results.filter((r) => r.status !== 200);
  if (nonOk.length) {
    console.error(`\nNon-200 responses: ${nonOk.map((r) => `${r.route}=${r.status}`).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
