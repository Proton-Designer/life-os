# Navigation latency, round 2: prefetch delivers nothing

**Status:** design, approved for build — Ayman reported it directly, measurements below are done
**Author:** Opus Lead, 2026-08-18
**Supersedes nothing.** The 2026-08-16 spec (`2026-08-16-navigation-latency-fix.md`) is still correct
about the purge model. This is the piece it missed.

## The report

> "Whenever I click on a new screen for the first time, or after a couple minutes, it takes one to
> two seconds. There's a white loading indicator to the right of the button and it stays for about a
> second. So the user stays on the old screen they're switching from, and then it switches over. It
> feels like it's getting stuck. It should immediately switch over to the new screen and show the
> last received data... then get updated in the background, and right when the new information comes
> in, the information should be updated."

Confirmed by him to apply to **any** cross-screen `<Link>`, not just the nav — he named the Home →
weekly-planning button specifically.

Two things he is describing are the 2026-08-16 fix working as designed: the previous screen holding
instead of blanking (Phase 1, loading boundaries removed) and the indicator on the tapped item
(Phase 2, `useLinkStatus`). He is not asking for the skeleton back. He is asking for the **hold** to
go away, which is the right thing to ask for — with a real cache hit neither of those two ever shows.

## Root cause

Every `<Link>` in this codebase uses the default `prefetch`. Zero occurrences of the prop anywhere
(`grep -rn prefetch components/ app/` → nothing).

From Next 16.3's own bundled docs (`node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md`):

> **`"auto"` or `null` (default)**: For static routes, the full route will be prefetched. For dynamic
> routes, the partial route **down to the nearest segment with a `loading.js` boundary** will be
> prefetched.

Every route in this app is dynamic (auth-gated — `next.config.ts` says so explicitly), and
2026-08-16's Phase 1 deleted **all nine** `loading.tsx` files, including the route-group
`app/(app)/loading.tsx`.

**So there is no boundary left to prefetch down to.** The prefetch request still fires; its response
carries nothing the Router Cache can serve a navigation from. The click then fetches the whole route
cold.

This was created by the Phase 1 fix and went unnoticed because that round measured *server render
time* and *skeleton/blank contract* — neither of which can see a prefetch that fires and returns
nothing useful. It is the direct cause of the symptom Ayman has now reported three times.

### Measured, `next start` production build, real signed-in SEED session

**Wasted work.** 16 RSC requests fire on a single Home load with zero interaction — all 8 routes,
twice each, every one carrying `next-router-prefetch: 1`. (The doubling is the already-logged
`vercel/next.js#86130` route-group + nonzero `staleTimes.dynamic` duplicate, now confirmed a third
time.)

**The prefetch buys nothing.** Clicking a nav link a full 3s after its prefetch completed:

| | requests at click | click → new screen |
|---|---|---|
| default `prefetch` (today) | 1 | **315–476ms** |
| `prefetch` (i.e. `={true}`) | **0** | **32–44ms** |

**It survives the purge, with a gap.** `revalidatePath` still purges the whole Router Cache on every
write. Measured on routes the mutation never named, after marking a prayer on `/deen`:

| navigate after mutation | requests at click | click → new screen |
|---|---|---|
| immediately | 2 *(count unreliable — see below)* | 395ms |
| ~2.5s later | **0** | **29ms** |

**The request count in that first row is retracted, the timing is not.** It came from a header-based
script, and per the Part C correction below, Full-strategy prefetches carry no header — so those 2
requests may have been the unmarked background re-prefetch still in flight rather than click-triggered
work. The 395ms elapsed is method-independent and stands, which is what the conclusion rests on. The
joint re-measure for criteria 3/4/7 must use the settle-based method and treat this row as superseded
rather than as a baseline to match.

Next re-prefetches the in-viewport links after a purge; it needs a couple of seconds to land. So this
does not make navigation instant unconditionally — it makes it instant **except within a few seconds
of a write**, instead of slow on every single navigation.

That residual window is exactly what Phase 4's server-time work shrinks, which is why the `proxy.ts`
item below is in the same batch rather than deferred again.

## The fix

### Part A — `prefetch` on every cross-screen `<Link>`

Add the prop to every `<Link>` that navigates between app screens:

- `components/shell/sidebar-nav.tsx` — all three variants (icon-rail, expanded, drawer)
- `components/shell/mobile-island.tsx` — the island items **and** the "More" popover
- `components/shell/top-nav.tsx` — orphaned but still a real tested component; keep it consistent
- Every domain doorway on Home and elsewhere: `components/home/weekly-focus.tsx:27,67`,
  `components/home/focus-module.tsx:32`, and anything else `grep -rn 'href="/' components/ app/`
  turns up that is a real in-app navigation

Do **not** add it to `<Link>`s that aren't cross-screen navigation (anchors, external links).

**The cost, stated plainly rather than discovered later:** this makes every page load issue a full
render of all 8 sibling routes on the server (16 requests until #86130 is fixed upstream). For a
single-user app on Vercel that is an acceptable trade for instant navigation, and it is the trade
Ayman explicitly asked for. If it ever shows up as a cost problem, the lever is dropping `prefetch`
from the rarely-used routes (`/settings`, `/co-op`), not from the nav as a whole.

### Part B — `proxy.ts`: `getUser()` → `getClaims()`

Measured 2026-08-16 by the Lead in an isolated experiment: mean server time **345ms → 182ms**, a 47%
cut from one line. It was left with Ayman then because it is a security-posture decision, not a
performance one, and it has been sitting unruled since.

**Taking it now, on the Lead's recommendation, stated so it can be reversed in one line.**
`getUser()` contacts the Auth server on every request, so a remotely-revoked session dies instantly.
`getClaims()` verifies the ES256 signature locally against the published JWKS — real cryptography,
not a skipped check — so a revoked session survives until its next token refresh: measured `exp - iat`
= 3600s on this project, averaging ~30 min in practice since refresh always contacts the Auth server.
For a single-user personal app that exposure is negligible, and it directly shrinks the 395ms
post-mutation window in Part A's table, which is the only case where Part A doesn't already win.

`lib/supabase/auth.ts` already moved to `getClaims()` in Phase 4; this is the same change in the one
place it was deliberately not applied.

**Verify auth still works for real, not just that it's faster** — same bar as Phase 4: unauthenticated
`/deen` → `/login`; sign in → `/deen` reachable; sign out through the real UI control → `/deen` →
`/login`; onboarding redirect by flipping `onboarding_completed` false and back.

### Part C — Repair and extend the perf harnesses

**`scripts/perf/measure-mutation.mjs` is broken right now.** It locates the prayer row with
`page.locator("li", { hasText: "Isha" })`. The qada backlog shipped overnight (`bfee70b`) added
`Isha · Aug 10` and `Isha · Aug 12` items to the same page, so that selector resolves to 3 elements
and Playwright throws on strict mode. Scope it to the row that actually has the status buttons:

```js
page.locator("li", { hasText: "Isha" })
    .filter({ has: page.getByRole("button", { name: "On-time" }) })
    .first()
```

Check `e2e/deen.spec.ts` for the same pattern while you're in there.

**Add `scripts/perf/measure-prefetch.mjs`**, the regression test this round needed and didn't have:
land on a route via a real `<Link>` click, settle, then click each nav target and assert **0**
non-prefetch RSC requests at click time. **Do not distinguish prefetch from navigation by the `next-router-prefetch: 1`
header — that instruction, in an earlier version of this spec, was wrong.** (Corrected 2026-08-18
after Engineer 2 found the mechanism in Next's own source.) `next-router-prefetch` is only set, in
`node_modules/next/dist/client/components/segment-cache/cache.js`, for FetchStrategy.PPRRuntime /
RuntimeShell / LoadingBoundary. For **FetchStrategy.Full** — exactly what `<Link prefetch>` selects,
per `link.js`'s `prefetchIntent` mapping — the switch sets no header and breaks. A Full-strategy
prefetch is therefore wire-identical to a real navigation fetch, and after Part A those are the
majority of what this app issues. A header-based harness misreports every one of them as a
click-triggered miss.

Key off **timing** instead: treat any `rsc: 1` response observed strictly before the click as a
prefetch, count only what fires after it, and put a real settle (3000ms measured clean) ahead of each
measured click. Say all of this in the script's header comment — the header approach looks correct and
silently isn't, which is exactly the trap a later session falls back into.

Also fix `clear-prayer`'s documented payload while you're here: the route reads `prayerName`, and a
harness calling it with `prayer` gets a silent 400. (Cost the Lead a stray SEED row tonight; caught
because the script checked the response status, per the README's own rule. Row restored.)

## Acceptance criteria

Measured, not asserted, against `next start` — never `next dev`, where prefetch is disabled outright.

1. `measure-prefetch.mjs`: 0 non-prefetch RSC requests at click time on all 9 routes, warm.
2. Click → new screen under ~60ms warm, on all 9 routes.
3. Post-mutation, after a ~2.5s settle: 0 requests, comparable timing. Report the immediate-navigation
   number honestly rather than only the settled one.
4. `measure-server-time.mjs` re-run across all 9 routes after Part B, medians of 7, before/after.
5. No skeleton and no blank screen at any point — `measure-navigation.mjs` still green. Part A must
   not reintroduce what Phase 1 removed.
6. The pending indicator still behaves: present on a genuine wait, never flashing on a cache hit.
7. Auth verified live per Part B, all four flows.
8. 9 routes × 3 breakpoints (1600/1024/390) clean console.
9. `tsc`, `eslint`, full `vitest`, `next build` clean.
10. SEED account left exactly as found; every cleanup call's response status checked and logged.
