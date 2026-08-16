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
