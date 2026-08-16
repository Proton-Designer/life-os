# Navigation-latency research: prior art on stale-while-revalidate for revisits

Research-only deliverable for the Opus Lead's navigation-latency investigation. No application code
was written or changed. Scope: Q1 (prior art), Q2 (judgment for our case), Q3 (traps). Sources cited
inline; anything not attributed to a source is my own inference, flagged as such.

Two facts the Lead already established locally (not re-derived here):
1. `next.config.ts` sets `experimental.staleTimes: { dynamic: 3600 }` — a real Next 16.3 key.
2. Next's own 16.3 docs for `revalidatePath` warn it currently refreshes all previously visited pages.

---

## Q1 — Prior art: the concrete mechanism, not the platitude

### TanStack Query (React Query)

- **`staleTime` vs `gcTime`.** `staleTime` (default `0` in v5) controls how long data is considered
  fresh enough to skip a refetch on mount/focus/reconnect. `gcTime` (renamed from `cacheTime` in v5,
  default 5 min) controls how long *unused* data stays in memory before eviction. These answer two
  different questions — "is this good enough to show without refetching" vs. "how long do I keep it
  around at all" — and conflating them is the most common misuse.
  [Migrating to v5](https://tanstack.com/query/v5/docs/framework/react/guides/migrating-to-v5) ·
  [staleTime vs gcTime](https://medium.com/@bloodturtle/understanding-staletime-vs-gctime-in-tanstack-query-e9928d3e41d4)
- **What's on screen during a background refetch.** With `staleTime > 0`, a remount/refocus inside
  the stale window serves cached data with **zero network request** and no loading state at all. Once
  stale, TanStack Query still renders the cached data immediately and fires a background refetch —
  the UI never drops to a loading/skeleton state on a revisit; it silently patches in place when the
  response lands. [TanStack Query reference](https://tanstack.com/query/v4/docs/framework/react/reference/useQuery)
- **`placeholderData`/`keepPreviousData`.** `keepPreviousData` was removed in v5 in favor of
  `placeholderData: keepPreviousData` — same effect (keep showing the last-known-good data while a
  *new* query key is loading, e.g. pagination), with one behavioral difference: `keepPreviousData`
  preserved the real `dataUpdatedAt` of the previous data, `placeholderData` resets it to `0` since
  it's explicitly marked as a placeholder, not real data.
  [Discussion #6460](https://github.com/TanStack/query/discussions/6460)
- **`refetchOnWindowFocus` defaults to `true`.** The design bet: a background tab is the most likely
  place for data to go stale under the user without the app knowing, so revalidate the instant
  attention returns — but because `staleTime` gates it, this refetch is silent unless the data is
  actually stale. [useQuery reference](https://tanstack.com/query/v4/docs/framework/react/reference/useQuery)

### SWR

- Same contract, Vercel's own naming for the pattern: return cached (stale) data immediately, then
  revalidate in the background and swap silently when fresh data lands — never blocking the UI.
  `revalidateOnFocus` also defaults to `true`, for the same background-tab-staleness reasoning as
  TanStack. [SWR: Automatic Revalidation](https://swr.vercel.app/docs/revalidation) ·
  [Understanding SWR](https://dev.to/abhay_yt_52a8e72b213be229/understanding-swr-stale-while-revalidate-in-react-for-optimized-data-fetching-1kld)
- The library's entire name **is** the RFC 5861 HTTP cache-control extension (`stale-while-revalidate`)
  — it's not a metaphor, it's the same contract lifted from HTTP caching into a client data layer.

**Bottom line for both:** the mechanism that prevents the skeleton-on-revisit symptom is not "cache
longer," it's "always render *something* from cache first, treat network as background enrichment,
never let 'stale' collapse to 'absent.'" A `loading.js`/Suspense boundary in the Next model is binary
(there is cached data to show, or there is a full skeleton) — SWR/TanStack model it as a spectrum
(fresh / stale-but-shown / absent).

### Linear, Superhuman, Figma — the local-first / sync-engine school

- **Linear**: client state is authoritative. IndexedDB holds a full, normalized object graph loaded on
  startup; reads (including search) are synchronous in-memory filtering with 0ms latency; writes are
  optimistic and sync to the server asynchronously over GraphQL mutations + WebSocket push for deltas
  from other clients. Public talks by Tuomas Artman (Linear) are the primary technical source; a
  well-regarded reverse-engineering writeup corroborates the architecture.
  [Linear sync engine reverse-engineering](https://github.com/wzhudev/reverse-linear-sync-engine) ·
  [Reverse engineering Linear's sync magic](https://marknotfound.com/posts/reverse-engineering-linears-sync-magic/) ·
  [fujimon.com writeup](https://www.fujimon.com/blog/linear-sync-engine)
- **Superhuman**: published a two-part engineering series on making a web app "just work" offline —
  explicit design goal was speed (instant response) and robustness (works with no connection at all),
  which requires the same local-authoritative-store shape as Linear.
  [Architecting a web app to "just work" offline](https://blog.superhuman.com/architecting-a-web-app-to-just-work-offline-part-1/)
- **Figma**: not a REST/cache problem at all — it's real-time multiplayer over WebSockets to a
  per-document server process. Client applies edits optimistically to a local CRDT-like object tree
  (last-writer-wins per property), keeps unacknowledged edits in a local pending set, and reverts only
  the specific edits the server actually rejects. This is architecturally the closest of the three to
  "sync engine," but it's solving a different problem (concurrent multi-editor conflict resolution),
  not "don't show a skeleton on revisit."
  [How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) ·
  [Making multiplayer more reliable](https://www.figma.com/blog/making-multiplayer-more-reliable/)

**Honest cost of adopting this model** (my assessment, not sourced): all three require (a) a local
persisted store — IndexedDB in practice — that is treated as the source of truth for rendering, (b) a
sync protocol that reconciles that store with the server independently of any specific page
navigation (so "revisit" stops being a fetch event at all — the store is just always populated), and
(c) either a realtime transport (WebSocket) or a well-designed poll/delta-pull loop to keep the local
store from drifting silently. This is weeks of infrastructure, not a config flag, and it duplicates
your server as a second schema (the local normalized graph) that has to stay in migration-lockstep
with the real one. It is the correct answer when the product's core value prop *is* speed/offline
(email client, design tool, issue tracker used all day). It is a large hammer for "the dashboard
shows a skeleton after 2 minutes."

### Remix / React Router: `clientLoader` + `shouldRevalidate`

- Server `loader`s re-run on every matching navigation by default (no implicit caching layer at all —
  the opposite default from Next's Router Cache). `shouldRevalidate` is an **explicit, per-route
  opt-out**: you write the function that decides "should this route's loader re-run for this
  navigation," given the old/new params, form data, etc. There's no ambient TTL — you are always in
  the loop about staleness. `clientLoader` layers an actual client-side cache *on top of* that when
  you want it (e.g. cache in module scope, serve from cache, and choose whether to call the server
  `loader` at all).
  [shouldRevalidate docs](https://v2.remix.run/docs/route/should-revalidate/)
- The tradeoff is explicitly named in the docs: opting a route out of revalidation risks the UI going
  out of sync with the server, "so it should be used with caution" — i.e., Remix's model puts the
  correctness/speed tradeoff in the developer's hands per-route rather than picking one global default
  and shipping surprising cross-cutting behavior (which is exactly the class of bug Next's
  `revalidatePath`-clears-everything default produces).
- There's an open, currently-unresolved React Router bug where a child route's `clientLoader`
  re-executes even when that route's own `shouldRevalidate` returns `false`, in some fetcher-submission
  scenarios — worth noting only because it shows this problem class (an action in one place
  unexpectedly invalidating state elsewhere) isn't unique to Next; it recurs anywhere a framework tries
  to automate cache invalidation across a route tree.
  [Issue #12607](https://github.com/remix-run/react-router/issues/12607)

### The RSC-specific version of this problem (Next App Router)

This is well-documented as a *known, still-partially-unresolved* class of GitHub issues, not a rare
edge case:

- **`revalidatePath` purges the whole client Router Cache, not just the one path.** Confirmed by Next
  maintainer Tim Neutkens per the docs-accuracy issue; the official 16.3 docs (per the Lead's own
  finding) still describe this as current, intentional behavior — "it also causes all previously
  visited pages to refresh when navigated to again."
  [Issue #59214](https://github.com/vercel/next.js/issues/59214)
- **The mechanism, as explained by a Next collaborator (icyJoseph) in an Oct 2025 discussion**: when a
  Server Action calls `revalidatePath`, the *server* marks that route's cache stale for future
  requests, and **the response headers to the current request tell the browser to purge its
  client-side Router Cache immediately** — which is why the effect looks instantaneous even though the
  docs talk about "next visit." This is the concrete mechanism behind "every mutation invalidates
  everything," and it is why 60 call sites of `revalidatePath` across the app's Server Actions is a
  meaningful number, not incidental.
  [Discussion #81385](https://github.com/vercel/next.js/discussions/81385)
- **`revalidatePath` doesn't clear cache for client-side back navigation** in some cases — the inverse
  bug (stale content surviving revalidation) — reported against 14.1, no maintainer root-cause on
  record, unclear if it persists on 15/16.
  [Issue #61184](https://github.com/vercel/next.js/issues/61184)
- **`revalidatePath` doesn't invalidate the route cache for back/forward navigation** — a distinct,
  still-open issue about the browser back/forward interaction specifically (separate from Next's
  in-memory Router Cache).
  [Issue #73644](https://github.com/vercel/next.js/issues/73644)
- **The `staleTimes.dynamic` default itself changed in 15.0.0 — from 30s to 0s** — meaning out of the
  box, Next 15+ shows a full loading state on *every* revisit to a dynamic route once you leave the
  in-memory cache, not just after some multi-minute window. The 3600s override you already found is
  the correct lever for the "wait a couple minutes" symptom specifically. One nuance the doc states
  explicitly that's worth double-checking against the actual repro: **"Loading boundaries are
  considered reusable for the `static` period defined in this configuration"** — the doc's own good-to-know
  note ties loading-boundary reuse to the `static` value, phrased in a way that doesn't unambiguously
  confirm the same reuse guarantee applies to the `dynamic` value. Given this is exactly the mechanism
  you're root-causing, it's worth reading literally rather than assumed — I'm flagging it, not
  resolving it, per your instruction that you're doing the Next-internals side.
  [staleTimes config docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/staleTimes)
- **A live, unresolved bug in this exact area**: route groups + non-zero `staleTimes.dynamic` producing
  duplicated RSC requests, reported against a recent version — i.e., raising `dynamic` above 0 is not
  a purely inert config change, it has its own edge cases in the current codebase.
  [Issue #86130](https://github.com/vercel/next.js/issues/86130)
- **Supabase + Next.js App Router middleware overhead**: a long-running Supabase-maintained issue
  documents that Next prefetching every visible `<Link>` causes their SSR auth middleware to be invoked
  far more often than the visible navigation count would suggest (one report: 9 middleware calls per
  page load), which is adjacent to your problem — an auth-gated route's "is this fresh" check runs on
  a very different, uncoordinated cadence from the Router Cache's own TTL.
  [supabase/supabase#18285](https://github.com/supabase/supabase/issues/18285)

I did not find a single canonical "this is the RSC+Supabase+staleTimes bug" GitHub issue that matches
your exact repro end-to-end — the picture instead is several adjacent, independently-filed issues
(cache-purge-too-broad, cache-purge-too-narrow, staleTimes-dynamic-default-change,
staleTimes-dynamic-nonzero-has-bugs, middleware-runs-more-than-expected) that collectively describe a
system where **the client Router Cache, the Server Action revalidation signal, and the auth middleware
are three independently-tuned invalidation mechanisms with no single owner** — which matches the shape
of your symptom (intermittent, time-window-dependent, "nothing changed but it reloaded anyway") better
than any single bug would.

---

## Q2 — Judgment: what's proportionate for a single-user, ~10-route, Server-Action-only PWA

Given: one user, ~10 dynamic auth-gated routes, Supabase Postgres+RLS, all writes through Server
Actions (no REST/GraphQL API surface to point a client cache at).

**What each approach actually costs you here, concretely:**

- **Sync engine (Linear/Superhuman/Figma model)**: wrong tool. Its entire value is amortizing sync
  cost across either offline support or many concurrent editors on shared documents. You have neither
  — one user, one writer, online-only PWA. It would mean introducing IndexedDB, a normalized local
  schema mirroring Postgres, and a reconciliation layer, to solve a UI-affordance problem. Far over
  10% of a sync engine's complexity for the win you'd get.
- **TanStack Query / SWR bolted onto Server Actions**: plausible but partially redundant with what
  Next already gives you for free. You'd be maintaining a second cache (React Query's) *alongside*
  Next's own Router Cache and Data Cache, and would need every Server Action to also drive
  `queryClient.invalidateQueries`/`setQueryData` in addition to (or instead of) `revalidatePath` — real
  work, and two invalidation systems to keep in sync is itself a source of the bug class in Q1's last
  paragraph. Its `placeholderData`/stale-while-fresh *contract* is exactly the right shape, though —
  that's the part worth taking even if the library isn't.
- **Remix-style explicit `shouldRevalidate`**: not portable to Next's Server Action + Router Cache
  model as a library, but the *idea* — stop trusting a global TTL and instead make each mutation
  explicit about what it actually invalidates — maps directly onto swapping broad `revalidatePath`
  calls for narrow `revalidateTag` calls scoped to the specific data a given Server Action touched.
  This is the cheapest lever in the whole survey: it's a call-site change (tag the reads, tag the
  action), no new dependency, and it directly targets the documented "revalidatePath nukes the whole
  Router Cache" behavior from Q1.
- **Next's own `staleTimes` + a stale-while-revalidate *rendering* pattern (keep old segment on
  screen, patch in place)**: this is the ~90%-of-the-win-for-under-10%-of-the-complexity option,
  because it uses infrastructure you already have (the Lead has already set `staleTimes.dynamic:
  3600`) — the missing piece per the SWR/TanStack contract is not caching longer, it's **never letting
  the loading boundary render over already-known-good content**. Concretely, that means: on
  navigations where a route segment was already rendered this session, prefer keeping the last commit
  on screen during a background re-render (React 18/19's `useTransition`/`startTransition` around the
  navigation, so React treats the new tree as non-urgent instead of unmounting into Suspense) over
  relying on `loading.js` to disappear-and-reappear. This is a rendering-strategy change, not a caching
  one, and it's the one place the TanStack/SWR contract and the Next-native toolkit actually meet.

**What I'd pick, stated plainly**: narrow the `revalidatePath` calls to `revalidateTag`
(match-what-actually-changed, addressing the "every action invalidates everything" root cause
directly), keep the existing `staleTimes.dynamic: 3600` override, and wrap navigations in
`startTransition` so a still-fresh-enough segment stays visible while any real refetch happens in the
background — instead of adopting a second cache library. This is judgment, not something I verified
against your codebase (out of scope per your instructions) — flagging where I'd want a second look
once you're in the design phase: whether `revalidateTag` composes cleanly with `unstable_cache`-wrapped
Supabase reads (it should, per the caching docs above, but I haven't traced your actual data-layer
call sites).

If your framing is "we need a proper client cache, which one" — I'd say that framing may be premature.
The evidence above says the actual bug is *too-broad invalidation*, not *too little caching*; adding a
second cache on top of an over-eager invalidation problem tends to just give the over-invalidation two
things to nuke instead of one.

---

## Q3 — Traps: what breaks when this is done naively

- **Showing stale data that is actually wrong.** The single most literal risk of any
  stale-while-revalidate approach: if the underlying Postgres row changed for a reason *other than*
  this client's own Server Action (a scheduled job, a direct SQL edit, a second device/tab), a `staleTimes`
  window means the UI can show provably-wrong data for up to that window's duration with zero
  indication it's stale — SWR/TanStack's `revalidateOnFocus` exists specifically to bound this risk on
  window/tab refocus; a bare `staleTimes` bump on Next's Router Cache doesn't have an equivalent
  "revalidate on refocus" hook without you wiring `router.refresh()` to a `visibilitychange` listener
  yourself.
- **Double-render flashes.** If a background refetch swaps in a differently-shaped result (e.g. list
  went from populated → empty because a filter changed underneath), the "keep old content, patch in
  place" strategy can produce a jarring layout jump *after* the user has already started reading the
  stale version, which is arguably worse UX than a single consistent skeleton — this is inference on
  my part, not sourced, but it's the standard argument against overusing `keepPreviousData`/
  `placeholderData` for anything other than pagination-shaped changes.
- **Optimistic updates diverging from server truth on error.** TanStack's own guidance (see Q1) is
  explicit: snapshot in `onMutate`, roll back precisely in `onError`, and prefer invalidate-and-refetch
  in `onSettled` over trusting the optimistic write as final — the trap is skipping the rollback path
  because "it'll basically always succeed" for a single-user app; RLS policy failures, network drops
  mid-Server-Action, and Postgres constraint violations are all real failure modes here even without
  concurrent users.
- **Cache surviving across users on a shared device.** Real-world precedent found directly on point: a
  QA report of a PWA where a user "logged out and logged back in as a different user, but I'm still
  seeing the old user's data" — caused by a service worker's runtime cache (Cache Storage API) not
  being scoped to the session and not being cleared on logout. You are single-user in practice, but
  worth recording the reasoning either way per your instruction: the fix pattern (clear/version the SW
  cache on auth state change, never cache personalized/API responses in the SW layer) costs almost
  nothing to build in now and removes an entire class of bug if that ever changes (a second household
  member, a demo account, a future multi-tenant pivot).
  [Client-side caching risk discussion](https://borstch.com/blog/caching-strategies-in-pwa-cache-first-network-first-stale-while-revalidate-etc)
- **Service worker interaction with `public/sw.js`.** This is the trap most specific to your stack: the
  service worker's Cache Storage is a *third*, completely independent cache layer from (a) Next's
  Router Cache and (b) any client data-fetching cache you might add. None of these three know about
  each other. Concretely: if `sw.js` runs a stale-while-revalidate strategy over the same routes
  (common in PWA boilerplates that cache-all-GET), you can get a state where the service worker serves
  a cached HTML/RSC response *underneath* a Router Cache that has already correctly invalidated and
  wants to refetch — i.e. the service worker silently re-introduces the exact staleness the Router
  Cache invalidation was supposed to fix, and because it sits at the network layer, `revalidatePath`/
  `revalidateTag` have no visibility into it at all. Auth-gated, per-request, RLS-scoped API/RSC
  responses should not be in the service worker's runtime cache scope in the first place — this is a
  known "personal data should not be cached" recommendation for PWAs generally, not specific to Next.
  [PWA caching strategies overview](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching)

**Framing check, since you asked**: I don't think your framing is wrong, but I'd flag one thing — the
"revisit after a couple minutes" symptom description is consistent with *at least two independent
causes* that would call for different fixes: (1) `staleTimes.dynamic` expiring (time-based, matches
"couple minutes" literally), and (2) any Server Action fired in the interim (even one unrelated to the
route being revisited) triggering the whole-Router-Cache purge documented in Q1's `revalidatePath`
section (event-based, would *look* time-correlated if the user's habitual pattern is "do something on
screen A, wait, go check screen B"). Worth confirming in the local repro which one it actually is
before designing around either — they'd point at different fixes (a config bump vs. a
`revalidatePath`→`revalidateTag` narrowing pass).
