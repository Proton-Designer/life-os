# Home restructure: focus-first layout

**Status:** design, approved for build
**Author:** Opus Lead, 2026-08-17
**Requested by:** Ayman, 2026-08-17 22:17 CDT

## The ask, verbatim

> Replace the current top module where it displays "Today" and currently says setup your location… with
> the following module: this module should be the immediate focus module of the next exact tasks that
> need to get done in that moment for that day. So this should display the next pending task for deen,
> next pending task on the kill list, next pending task for fitness, school, and co-op (if and whenever
> those are applicable). To the right of this module should be another module that displays the Focus
> time today, and the ability to start a focus session.
>
> Below the action item list, should be a weekly focus module, this should display the weekly goal in
> deen and the weekly goal for business to have that accessible and in focus immediately so its
> constantly in the back of the head. Then to the right of this module should be the current sector
> progress breakdown module where it shows percentage completed of deen, business, fitness, school,
> and co-op.
>
> Remove the 4 modules that are currently present on the home page located in the middle (Deen today,
> today's completion, Focus time today, prayer streak), the ones that mattered in this homepage i
> included somewhere above in some way shape or form.

### Reading of "the current sector progress breakdown module"

Taken as the **existing `DomainStatusStack`** — it is already the only per-domain progress module on
Home, already covers all five sectors, and its `ProgressRing` already renders a numeric percentage.
So it is **moved**, not rebuilt. This reading also avoids showing the same five percentages twice on
one screen, which the codebase's own one-metric rule forbids.

## Target layout

```
PageHeader "Home"

Row A   lg:grid-cols-12
  col-span-8   Panel "Now"                 → <NextActions>        (NEW, client)
  col-span-4   Panel "Focus"               → <FocusModule>        (NEW, client)

Row B   lg:grid-cols-12
  col-span-8   Panel "This week's focus"   → <WeeklyFocus>        (NEW, server)
  col-span-4   <DomainStatusStack title="Sector progress">        (MOVED up from Row C)

Row C   full width
  Panel "Right now / Later today"          → <PriorityList>       (unchanged, now full width)

Row D   lg:grid-cols-12                    (unchanged)
  col-span-8   Panel "This week"           → AreaChart
  col-span-4   Panel "Signal:Noise this week" → DonutChart
```

### Removed

1. The `Panel title="Today"` block at the top — both the `<DayRibbon>` branch and the
   "Set your location in Settings" `EmptyState` branch.
2. The entire four-card KPI carousel row: `<NextUpHero>`, "Today's completion", "Focus time today",
   "Prayer streak". This is the row Ayman calls "the 4 modules in the middle."

`components/home/next-up-hero.tsx` **stays.** An earlier draft of this spec said to delete it on the
claim that nothing else imported it; that was wrong — `app/(app)/deen/page.tsx:214` renders it as
Deen's own "next prayer" hero, with its own caption and `EmptyState` branch. Deleting it would break
`/deen`'s build. Home drops its *usage* and its import; the component and its test remain live code.
(Caught by Engineer 2 before the delete landed, 2026-08-17.)

`components/home/day-ribbon.tsx` and `lib/home/day-ribbon.ts` become orphaned. **Leave them and their
tests in place**, and add them to the standing orphan list awaiting Ayman's call (alongside
`components/shell/top-nav.tsx` and the `adhkar`/`traveling` code). Do not delete them in this change.

## Components

Every new component takes **only serializable props**. `WeeklyFocus` is a Server Component and so is
structurally exempt. `NextActions` and `FocusModule` are Client Components: they import their Server
Actions directly from the actions module (exactly as `LockInPanel` imports `startWorkSession`), so no
function ever crosses the RSC boundary. See `AGENTS.md` — this is the rule that has bitten this
project twice, and `tsc`/`vitest` cannot catch a violation.

### 1. `lib/home/next-actions.ts` — pure selector (NEW)

```ts
import type { PriorityItem, Domain } from "./types";

/** Fixed display order, per Ayman's enumeration: deen, kill list, fitness, school, co-op. */
export const NEXT_ACTION_ORDER: Domain[] = ["deen", "business", "fitness", "school", "co_op"];

/**
 * One item per domain — the most urgent pending item in each — in a stable
 * domain order. Domains with nothing pending are omitted entirely ("if and
 * whenever those are applicable").
 */
export function selectNextActionPerDomain(items: PriorityItem[]): PriorityItem[];
```

`getPriorityItems` already returns items sorted most-urgent-first globally, so "the most urgent
pending item in a domain" is just the first match for that domain. Do not re-sort.

Unit tests: one per domain present; domains with no pending item omitted; empty input → empty output;
order is always `NEXT_ACTION_ORDER` regardless of input order; picks the *first* (most urgent) item
when a domain has several (e.g. three pending prayers → Fajr, not Isha).

### 2. `components/home/next-actions.tsx` — the "Now" module (NEW, `"use client"`)

Props: `{ items: PriorityItem[] }` — the full priority list; the component calls
`selectNextActionPerDomain` itself.

Each row renders: `IconChip` (domain accent, `size="sm"`) · domain label · item title · relative due
time · a complete button. Reuse `DOMAIN_ICON`, `DOMAIN_ACCENT`, `ACCENT_VAR`, and `ListRow`.

- Completion goes through the existing `toggleItem` Server Action with `useOptimistic` +
  `startTransition`, copying `PriorityList`'s `Row` pattern exactly — including dispatching the
  optimistic update as the transition's first synchronous step so React can revert it on failure.
- Button `aria-label`: `Mark "{title}" done`, same as `PriorityList`, so the existing e2e selector
  keeps working. **Note for e2e:** this means two elements can now match that label on Home (this
  module and the list below). Scope e2e selectors to a container; see §Tests.
- Relative time: reuse `formatRelativeDuration`. Tick every 60s with `now` starting as `null` on
  first render and falling back to the server-computed value — the hydration-safe pattern already
  documented in `priority-list.tsx`. Do not deviate.
- The single most urgent item across the module (the one whose `urgencyBucket` is `right_now` and
  earliest `dueAt`) gets a subtle emphasis — a `Badge` reading `Now`. One badge maximum.
- Empty state (no domain has anything pending): `EmptyState` with
  `message="You're all clear"` and `action={{ label: "Plan the week", href: "/weekly-planning" }}`.
  Fresh-install copy stays as it is today: `"Welcome — head into a domain tab to get started"` when
  `isFreshInstall`. Pass `isFreshInstall` in as a boolean prop.

### 3. `components/home/focus-module.tsx` (NEW, `"use client"`)

Props:

```ts
{
  focusMinutesToday: number;
  sessionCount: number;
  activeSession: { id: string; startedAtIso: string } | null;
}
```

- **Idle:** hero value `formatElapsedDuration(focusMinutesToday * 60_000)`, caption
  `"{n} Lock-In session(s)"` or `"No Lock-In sessions yet today"`, and a full-width `Lock In` button
  calling `startWorkSession()` inside `startTransition`; on resolve, swap to the active view using
  the action's return value (`useState`, no `router.refresh()` — see the reverted focus-refresh
  regression of 2026-08-14).
- **Active:** a live elapsed timer ticking client-side from `startedAtIso`, plus a
  `Link href="/business"` reading `Open session →`.

**Deliberately not `LockInPanel`.** Reusing it would mount `LockInSession` — and therefore
`CheckinPrompt` and its 60s polling — on a second route, giving two independent prompt owners for one
session. Home gets a compact module; `/business` remains the single place the check-in flow lives.
Shared logic (`startWorkSession`, `formatElapsedDuration`) is imported, not duplicated.

### 4. `components/home/weekly-focus.tsx` (NEW, Server Component)

Props:

```ts
{
  deen: { headline: string; milestones: string[]; quranPages: number; quranTarget: number | null } | null;
  business: { headline: string; milestones: string[] } | null;
  showPlanningNudge: boolean;
}
```

Two blocks side by side (`sm:grid-cols-2`, stacked below): Deen and Business. Each shows the headline
in `font-medium`, milestones as a compact bulleted list, and — Deen only, when `quranTarget` is set —
a `Qur'an {quranPages}/{quranTarget} pages` line.

- A domain with no goal for the current week renders a compact
  `Set this week's {domain} goal →` link to `/weekly-planning` rather than an `EmptyState` (two
  full EmptyStates side by side is too much dead space in a col-span-8 panel).
- The Saturday-evening planning nudge (`showPlanningNudge`) moves here from the priority-list panel —
  it is about goals, and this is now the goals module. Same markup and copy as today.

### 5. `components/home/domain-status-stack.tsx` (MODIFIED)

- Add optional `title?: string`, rendered as `text-sm font-medium` inside the existing container (do
  **not** wrap the component in a `Panel` — that double-borders it). Home passes `"Sector progress"`.
- `ProgressRing` is currently `size={32} strokeWidth={3}`. Its percentage label is `text-xs` (12px)
  absolutely centered — `100%` does not fit inside a 26px inner diameter. Since this module's whole
  job is now communicating percentages, **verify in a real browser at all three breakpoints and size
  the ring so `100%` fits without touching the stroke** (expect ~`size={44} strokeWidth={4}`).
- Co-op stops borrowing School's ring — see §Data.

## Data

### `lib/home/get-domain-pulse.ts` (MODIFIED)

Three changes:

1. **Co-op gets its own fraction.** `DomainPulse` becomes five keys; `school` counts only
   `domain === "school"` tasks and `co_op` only `domain === "co_op"` tasks. Today they are pooled
   into `school` and `getDomainSnapshots` hands the same number to both rows — which is exactly the
   thing this module must not do.
2. **Fitness counts the scheduled workout.** Today fitness is `custom_habits(fitness)` only, so an
   account with a workout schedule and no fitness habits reads 0% forever. Make it
   `done = habitsDone + (workoutDone ? 1 : 0)`, `total = habits + (hasScheduledWorkout ? 1 : 0)` —
   the same model `computeTodayCompletion` in `lib/home/home-kpis.ts` already uses. This needs two
   new reads in `PulseDataSource`: `getWorkoutSchedule(userId, dayOfWeek)` and
   `getWorkoutLogs(userId, date)`. Copy the query shapes from `get-priority-items.ts`'s default data
   source verbatim.
3. **Nothing tracked ≠ zero progress.** Each value becomes `number | null`; `safeFraction` returns
   `null` when `total === 0`. `ProgressRing` gains `pct: number | null` — on `null` it renders the
   track circle only and a muted `—`, with `aria-label="Not tracked today"`. A `0%` ring on a day
   with nothing scheduled is a wrong number, and this module exists to show numbers.

`getDomainSnapshots`'s five `pulse` fields become `number | null` and `co_op` reads `pulse.co_op`.
Update `get-domain-pulse.test.ts`, `get-domain-snapshots.test.ts`, and
`domain-status-stack.test.tsx` accordingly. `components/home/domain-peek-card*.tsx` are orphaned but
still compile — fix their types, don't revive or delete them.

### `lib/business/active-session.ts` (NEW)

```ts
export const getActiveWorkSession = cache(async (userId: string): Promise<{ id: string; startedAt: string } | null> => …);
```

`AppShell` already runs this exact query on every request for the topbar's Lock-In dot, and Home now
needs it too. Wrap it in React `cache()` and have **both** call it, so Home costs zero extra round
trips. Refactor `AppShell`'s private `getHasActiveLockIn` to `Boolean(await getActiveWorkSession(...))`.
Keep it request-scoped only — no cross-request caching.

### `lib/home/get-home-extras.ts` (MODIFIED)

After the removals, three of its outputs have no consumer. Slim `HomeExtras` to:

```ts
{ focusTimeMinutes, focusSessionCount, weeklyCompletionPct, weeklyCompletionLabels }
```

Drop `dayRibbon`, `todayCompletion`, and `prayerStreak`, the `computeDayRibbon` call, and — the real
win — **the `checkins` query, which fed nothing but the ribbon.** That is one fewer round trip on
Home's critical path, straight in line with yesterday's navigation-latency work. Every other query
still feeds `weeklyCompletionPct`; leave them. `lib/home/home-kpis.ts` and `lib/deen/prayer-streak.ts`
stay — they have their own tests and other callers.

### `app/(app)/page.tsx` (REWRITTEN BODY)

One new query, added to the existing `Promise.all` — never sequentially:

```ts
supabase
  .from("weekly_goals")
  .select("domain, headline, milestones, quran_page_target")
  .eq("user_id", userId)
  .eq("week_start_date", weekStart)
  .in("domain", ["deen", "business"]);
```

`quranPages` for the Deen block comes from `snapshots.deen.quranWeekPages`, and `quranTarget` from
`snapshots.deen.quranWeeklyTarget` — both already fetched, do not re-query. `activeSession` comes
from `getActiveWorkSession(userId)` (also inside the `Promise.all`). Keep the Saturday-evening
`weekly_goals` lookup for the *upcoming* week exactly as it is; it is conditional and separate.

Delete the now-unused imports (`DayRibbon`, `NextUpHero`, `KpiCard`, `Flame`, `Timer`, `Inbox` if
unused, `formatDurationMagnitude`) and the `completionCaption` / `completionDelta` / `todayPct` /
`yesterdayPct` block. `weeklyAvgPct` and `bestDayIndex` stay — Row D still uses them.

## Tests

Everything in this project is verified, not asserted. Required before anyone reports done:

1. New unit tests: `lib/home/__tests__/next-actions.test.ts` (cases listed in §1).
2. New component tests: `next-actions.test.tsx`, `focus-module.test.tsx`, `weekly-focus.test.tsx` —
   render states, empty states, optimistic completion, active-vs-idle focus module.
3. Updated: `get-domain-pulse.test.ts` (co-op split, fitness workout, `null` on no-work),
   `get-domain-snapshots.test.ts`, `domain-status-stack.test.tsx` (title prop, `null` pulse).
4. `components/home/__tests__/next-up-hero.test.tsx` is **kept** — it covers a component that is
   still live on `/deen`. See the note above.
5. `e2e/home.spec.ts` updated: the day-ribbon assertion and the `"Mark done"` (NextUpHero) assertion
   both target removed UI. Replace with assertions on the new modules. **The `Mark "…" done` label
   now matches in two places** — scope the toggle test's locator to the priority-list panel, or the
   test will resolve ambiguously and fail intermittently.
6. `tsc --noEmit`, `eslint`, full `vitest`, and `next build` all clean.
7. **Live browser verification at 1600 / 1024 / 390px** with a clean console — per `AGENTS.md`, an
   RSC serialization violation is invisible to every automated check above. Confirm: no console
   errors, no horizontal overflow, the ring percentages legible, and the Lock In button actually
   starting a session against the SEED account (not Ayman's data).

## Acceptance criteria

1. Top of Home is the Now module, with one row per applicable domain and nothing for domains with
   nothing pending — never a "Set your location" empty state.
2. Focus module shows today's focus time and starts a session in one tap, without a page reload.
3. Weekly Deen and Business goals are visible on Home without navigating.
4. Five sector percentages, each domain's own — co-op no longer mirrors school, and a domain with
   nothing scheduled reads `—`, not `0%`.
5. The four middle KPI cards and the Today/day-ribbon panel are gone.
6. No skeleton and no blank frame on navigation to Home — the Phase 1/2 latency guarantee holds.
7. Home's server render time does not regress against `scripts/perf/measure-server-time.mjs` taken
   before the change. One query added (weekly goals), one removed (checkins), one deduped
   (active session) — this should come out flat or slightly better. Measure it; don't assume.
