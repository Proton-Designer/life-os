# Navigation-latency measurement harnesses

Reusable scripts behind the findings in
`docs/superpowers/specs/2026-08-16-navigation-latency-fix.md`. Written after the
originals (built directly in a session's `/tmp` scratchpad) were lost when that
temp directory was cleaned — they should never have lived only there, since
every conclusion in the spec traces back to them and they'll be needed again
for any future routing/caching/auth change.

**Always run these against a `next start` production build, never `next dev`.**
Prefetching and the client Router Cache do not behave realistically in dev —
that distinction is the whole reason these exist as standalone scripts instead
of just eyeballing `next dev`.

```bash
npm run build
PORT=3100 npm run start &
BASE_URL=http://localhost:3100 node scripts/perf/measure-server-time.mjs
BASE_URL=http://localhost:3100 node scripts/perf/measure-navigation.mjs
BASE_URL=http://localhost:3100 node scripts/perf/measure-mutation.mjs
```

`BASE_URL` defaults to `http://localhost:3000` if unset. All three sign in
through the real `/login` form using `SEED_USER_EMAIL` / `SEED_USER_PASSWORD`
from `.env.local` — never Ayman's real account.

## What each one answers

- **`measure-server-time.mjs`** — "How long does the server actually take to
  render each route?" Fetches each route's RSC payload directly with real
  session cookies and the `RSC: 1` header (what Next's own `<Link>`
  prefetch/navigation fetches send), timing the server response only — no
  browser paint mixed in. Median of N runs per route with one discarded
  warm-up. This is the harness behind the Phase 4 numbers (getClaims vs
  getUser, serial vs parallel layout chain). Mutates nothing.

- **`measure-navigation.mjs`** — "Does clicking between routes ever blank the
  screen or show a full-screen skeleton?" Drives real `<Link>` clicks in a
  signed-in desktop session across all 9 routes, twice: once cold (first
  visit this session) and once warm (immediate revisit, expect a Router
  Cache hit — ~0 RSC requests). Records RSC request count, whether
  `[data-slot="skeleton"]` ever appeared, and whether the page's visible text
  ever dropped to zero length mid-transition. This is the direct regression
  test for the Phase 1/2 fix's user-visible contract. Mutates nothing.

- **`measure-mutation.mjs`** — "Does an unrelated mutation still purge every
  route, and does that purge still avoid a skeleton?" Marks today's Isha
  prayer on-time via the real UI (a genuine Server Action + `revalidatePath`
  call), then revisits two routes the mutation never named and checks for
  RSC requests (purge still happening — expected and deliberate, see the
  spec's "Which primitive purges what") and skeletons (should never appear).
  This is the harness that originally isolated the root cause: the "wait a
  few minutes" symptom is actually "since the last write, to anything."
  Restores Isha's prior status afterward — via the same UI button if it had
  one, or via the test-only `DELETE /api/test/clear-prayer` route
  (`E2E_TEST_SECRET`) if it was genuinely unlogged before. Checks the cleanup
  response status explicitly and reports failure loudly rather than silently
  leaving the real account mutated.

## Traps found while verifying these scripts against themselves (2026-08-16)

Both caught during the pre-deploy verification pass, before trusting any
result from a modified version of these scripts. Recorded here because they
evaporate the moment they only live in a chat log, and this exact area is
where they'll bite again.

- **`page.goto()` wipes the in-memory Router Cache.** It's a hard/top-level
  navigation, not a client-side transition, so it reloads the document and
  destroys whatever the client Router Cache was holding. A script that uses
  `page.goto()` to "return home" between navigation checks and then measures
  a "revisit" is actually measuring a cold load while believing it's
  measuring a cache hit — that produces a confident, completely wrong "the
  cache is broken" result. Always return via a real `<Link>` click
  (`page.locator('a[href="/"]:visible').first().click()`) when the point is
  to preserve cache state between steps.
- **A background `<Link>` prefetch can race an immediate same-session
  revisit.** Clicking a link fires a real RSC request even when the segment
  should already be cache-warm, if a prefetch triggered by the previous
  page's mount/visibility is still in flight when the next click lands.
  Observed directly: re-clicking a nav link within milliseconds of landing
  on the previous page showed 1-2 real RSC requests and a genuine (correct,
  not buggy) pending-indicator flash; adding a ~500ms settle before the
  measured click dropped that to 0 requests, 0 flash, on every surface
  tested. Any script measuring a "cache hit" click needs that settle window,
  or it will misreport a real cache hit as a miss.

## Known simplifications vs. the original harnesses

These are honest approximations, not exact reconstructions — nobody but the
prior session saw the originals' code.

- RSC-request detection matches on the `RSC: 1` request header and an exact
  path match; it does not attempt to distinguish a full-page navigation fetch
  from a `<Link>` prefetch fetch.
- "Went blank" is approximated by sampling `document.body.innerText.trim()`
  length on a 15ms interval during the transition and checking whether it
  ever hit zero — a real but coarse proxy for "the previous screen visibly
  disappeared."
- `measure-navigation.mjs`'s per-navigation "elapsed ms" is click-to-primary-
  response-plus-a-120ms-settle-buffer, not a paint-timing API measurement.

If a future session needs tighter fidelity than this, it's cheaper to sharpen
these three scripts than to reverse-engineer intent from scratch again.

## Observed-but-unexplained: duplicate RSC requests on some routes after a purge

`measure-mutation.mjs` has twice shown `/fitness` receiving 2 RSC requests
against `/school`'s 1 for the same `revalidatePath`-triggered purge (once in
the Opus Lead's original runs, once independently in the 2026-08-16
pre-deploy verification pass). Leading hypothesis, not yet verified by
anyone: `vercel/next.js#86130` documents route groups combined with a
nonzero `staleTimes.dynamic` producing duplicate RSC requests — this app
matches that shape exactly (everything under the `(app)` route group,
`staleTimes.dynamic: 3600`). Harmless either way — one redundant request, no
skeleton, no correctness impact — and unrelated to the `proxy.ts`/
`getClaims()` decision. Not investigated further; starting point for
whoever picks it up next.
