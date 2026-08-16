# Navigation latency: root cause and fix

**Status:** design, approved for build
**Author:** Opus Lead, 2026-08-16
**Companion research:** `docs/superpowers/research/2026-08-16-navigation-latency-research.md` (Sonnet Engineer)

## The report

> "Whenever you switch to a new screen, at first it takes like one to two seconds to load. Then if
> you switch to another screen and switch back, it shows immediately. But if you wait like two,
> three, four minutes and click that page again, then it loads again — even though there might not
> have been any change made."

And the requested behavior, verbatim in intent: show the old version of the screen right away, fetch
in the background, and update only the elements that actually changed — never a full-screen loading
state on a revisit.

## Root cause

Measured against a local `next start` production build hitting the real Supabase project. Every
number below is observed, not reasoned.

| Experiment | RSC reqs | Skeleton | Paint |
|---|---|---|---|
| Revisit immediately after first visit | 0 | no | 40ms |
| Revisit after **195s idle, no mutation** | **0** | **no** | **54ms** |
| Revisit after **one unrelated mutation** | 1–2 | **YES** | 330–454ms |
| Revisit again, no further mutation | 0 | no | 40ms |

**The trigger is not time. It is any write.** Ayman's "two to four minutes" is really "since the last
time I tapped something." In a tracking app you tap constantly, so an event-driven purge reads as a
timer. This is why the previous investigation could not reproduce it — on 2026-08-13 they idled a tab
for 3 minutes, measured 32ms, and correctly concluded the idle case was fixed. It was. They were
measuring the wrong axis.

The mechanism, from Next 16.3's own bundled docs for `revalidatePath`:

> **Server Functions**: Updates the UI immediately (if viewing the affected path). Currently, it also
> causes **all previously visited pages to refresh** when navigated to again.

We call `revalidatePath` **60 times** across our Server Actions. Each call discards the client Router
Cache for *every* route, not the path named. Confirmed independently by the engineer's research via
`vercel/next.js#59214`.

### Why `staleTimes` did not fix it

`experimental.staleTimes.dynamic: 3600` has been set since 2026-08-13. It is a real, schema-recognized
key in 16.3 and it works — it is exactly why the 195s idle test is a clean 0-request cache hit. It is
simply aimed at a mechanism that isn't the one firing. Invalidation beats expiry: a purged entry is
gone regardless of its staleTime.

### Why "show the old screen while revalidating" is not reachable by tuning caches

Tested directly by temporarily setting `staleTimes.dynamic: 15` and idling 40s:

| Route state | Skeleton | Paint |
|---|---|---|
| Merely **stale** (age > staleTime) | **YES** | 426–855ms |
| **Purged** (revalidatePath) | YES | 330–454ms |

**Stale and purged are the same thing to the client Router Cache.** For dynamic routes the cache is
binary — fresh (instant) or absent (skeleton). There is no stale-while-revalidate in this model. As
the engineer's research puts it: SWR and TanStack Query treat data as a spectrum (fresh /
stale-but-shown / absent) whereas a `loading.js` boundary is binary. No value of `staleTimes` produces
the behavior Ayman asked for.

### Which primitive purges what

Each row measured by patching the code, rebuilding, and re-running the harness.

| Mechanism | Purges *other* routes? |
|---|---|
| Server Action with no invalidation call (control) | **No** — 0 requests, 40ms |
| `revalidatePath()` | Yes, all of them |
| `refresh()` from `next/cache` | Yes, all of them |
| `router.refresh()` on the client | **Yes, all of them** |

The last row contradicts the bundled `useRouter` doc, which states `router.refresh()` "clears the
Client Cache for the current route." It does not; it clears everything. **There is no primitive in
Next 16.3 that refreshes one route while preserving the others.** Any design premised on selective
refresh is dead on arrival, which is why this spec does not attempt one.

### The finding the fix is built on

Removing the loading boundary changes navigation from *destructive* to *non-destructive*:

| Route | Skeleton | Went blank | Settle |
|---|---|---|---|
| `/fitness`, `/business` — boundary removed | **no** | **no** | 385ms / 361ms |
| `/school`, `/deen` — boundary kept | YES | YES | 372ms / 409ms |

With no boundary, **the previous screen stays fully on screen** — no grey bars, no blank — until the
new page is ready, then swaps complete. Note `app/(app)/loading.tsx` is a route-group boundary that
catches every child route; removing a per-route `loading.tsx` alone does nothing.

Separately confirmed: an in-place refresh of the route you are *looking at* produces **no skeleton and
no unmount**. Mutating the current screen is already non-destructive today.

## The fix

**Principle: keep the correctness, delete the flash, shorten the hold.**

We do not fight Next's invalidation model — with no selective-refresh primitive, that road ends at a
Cache Components migration (see Rejected). We keep the purge, which is what guarantees you never see
a stale prayer count, and we remove its *visible* cost.

### Phase 1 — Remove the full-screen loading boundaries (the flash)

Delete the nine page-level `loading.tsx` files **including `app/(app)/loading.tsx`**, which is the one
that actually catches most routes. Navigation then holds the current screen until the next is ready.

This is the whole user-visible fix. Everything after it is about making the hold short and legible.

### Phase 2 — Give the hold an affordance (`useLinkStatus`)

With no skeleton there is no feedback that a tap registered. Next 16.3 ships `useLinkStatus` — a
pending state scoped to the clicked `<Link>`. Put a restrained indicator on the nav item itself
(sidebar, top nav, mobile island): the row the user tapped shows it is working. Not a page-level bar,
not a spinner overlay — the point is that page structure never moves.

### Phase 3 — Targeted Suspense, only where a page is genuinely slow

Removing the page boundary also removes streaming: the server now renders the whole page before
sending anything. For most routes that is fine (~350ms). Where a single panel is the long pole
(Insights, heavy charts, consistency grids), wrap **that panel** in its own `<Suspense>` with a
skeleton sized to it, so critical content paints immediately and the expensive panel fills in.

Measure first, then place boundaries. Do not pre-emptively wrap everything — that recreates the
problem at a smaller scale.

### Phase 4 — Cut the server critical path (the hold itself)

~350–460ms locally, one outlier at 1092ms; on Vercel over mobile this is Ayman's "one to two seconds."
This is now the dominant remaining cost and every route pays it.

Current per-navigation shape, roughly four sequential network waves:

1. `proxy.ts` → `updateSession()` → Supabase Auth
2. layout → `getAuthedUser()` → `supabase.auth.getUser()` (network round trip to the Auth API)
3. layout → `getProfile()` (DB, sequential after 2)
4. `AppShell` → its own `work_sessions` query; page → its `Promise.all` batch

`cache()` already dedupes within a request, so this is about *sequencing*, not repetition.

**Baseline measured** (2026-08-16, `scratchpad/measure-supabase.mjs`, 7 iterations, medians, against
the real project — no repo files touched):

| Primitive | Median |
|---|---|
| Baseline round trip to Supabase | **83ms** |
| `auth.getUser()` — what `getAuthedUser()` calls | 84ms (a real network call) |
| `profiles` select — `getProfile()` | 112ms |
| `work_sessions` select — `AppShell` | 87ms |
| The three **in series** (today's shape) | **247ms** |
| The three **in parallel** | **88ms** |
| `auth.getClaims()` | **1ms** |

That accounts for the whole render: ~84 + ~112 + ~87 + page batch ≈ 380ms, against 350–460ms observed
end-to-end. The cost is almost entirely *sequencing and round trips*, not query work.

Two changes, worth ~250ms of the ~380ms:

1. **Parallelize the layout chain.** Serial 247ms → parallel 88ms. `getProfile()` currently awaits
   `getAuthedUser()` only to read `user.id`, and `AppShell`'s `work_sessions` lookup is a third serial
   wave. Restructure so they issue together. Keep `cache()` — it's doing its job; the problem is order.
2. **`getClaims()` instead of `getUser()`** — 84ms → 1ms, and it removes a wave from *both* the proxy
   and the layout. **Verified safe for this project:** tokens are signed **ES256** (asymmetric, EC) with
   a published JWKS at `/auth/v1/.well-known/jwks.json`, so `getClaims()` verifies the signature
   locally against the public key. This is trusted verification, not a trust-the-client shortcut — the
   1ms is real cryptography, not a skipped check. It would **not** be safe under symmetric HS256, so
   re-check the signing algorithm if Supabase's key config ever changes.

Expected: ~380ms → ~130ms, and proportionally larger in absolute terms on mobile where the 83ms
round trip is much worse. Re-measure after Phases 1–2 land; do not stack unverified changes.

## Rejected

**Cache Components (`cacheComponents: true`, `use cache: private`, `cacheTag`/`updateTag`).** This is
the framework-native version of what we want: per-tag invalidation, and with Partial Prefetching,
"invalidations refresh prefetches" silently. It is the *right* long-term answer and should be
revisited. Rejected now because it changes rendering semantics app-wide on an app that shipped a large
refactor yesterday, `use cache: private` is browser-memory-only (roughly what the Router Cache already
gives us), and there is an open bug (`#86130`) on route groups with nonzero `staleTimes.dynamic` — we
use a route group.

**Removing `revalidatePath` to stop the purge.** Buys 40ms navigations at the cost of showing data
that is actively wrong — log a prayer on Deen, open Home, see the old count. In a tracking app,
correctness of today's numbers is the product. Rejected.

**A client cache library (TanStack Query / SWR).** Would add a second invalidation system on top of
one that is already too broad, and every read here is a Server Component. Rejected; the engineer's
research independently reached the same conclusion.

**A local-first sync engine (the Linear/Figma model).** Solves offline and multiplayer. We have one
user, online. Disproportionate.

## Acceptance criteria

Measured, not asserted, using the harnesses in this session's scratchpad (hand them over):

1. **No skeleton on any navigation, cached or purged.** The previous screen holds; the page never
   goes blank.
2. **Correctness preserved:** mutate on Deen → navigate to Home → the changed number is right on
   first paint. This is the thing we must not trade away.
3. **Cache hits stay instant:** navigation with no intervening mutation stays ~40ms / 0 RSC requests.
4. **Post-mutation navigation settles under ~400ms locally**, and improves against the pre-change
   baseline in Phase 4.
5. Full unit suite, `tsc --noEmit`, `eslint`, and the e2e suite green — including any spec that
   asserts on skeletons.
6. **Verified in a real browser, not just tests** — per `AGENTS.md`, RSC serialization violations are
   invisible to tsc/vitest/jsdom. Any new client component (the `useLinkStatus` indicator especially)
   must be checked with a live render and a clean console.

## Notes for whoever picks this up next

- The 60 `revalidatePath` calls stay, but the paired `revalidatePath("/x") + revalidatePath("/")`
  pattern is redundant *today* (both purge everything). Leave them: the doc says the global behavior
  is "temporary," and precise paths are what will earn us per-path scoping for free when it lands.
- Cross-tab/cross-device staleness is still open and pre-existing: a passive tab keeps its cache for
  up to `staleTimes.dynamic` (1 hour). The 2026-08-13 design for a debounced `visibilitychange`
  → `router.refresh()` was specified but never implemented. It is now *safer* to add than it was then,
  because a refresh no longer flashes anything — but it purges all routes on every focus, so it should
  be sequenced after Phase 4 and measured, not assumed free.
