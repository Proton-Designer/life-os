# Frontend Structural Audit — Life OS

**Date:** 2026-08-15
**Requested by:** Opus Lead, for the structural (shell + grid) refactor spec following the Ayman feedback that the app "looks barebones/vibe-coded" and has "terrible space utilization" despite Phases A–F (component restyle) shipping cleanly.
**Scope:** read-only research. No code changed.

---

## TL;DR — the 5 facts that matter most for the spec

1. **The shell applies zero horizontal constraint.** `components/shell/app-shell.tsx`'s `<main>` only carries vertical padding to clear the fixed nav/island. Every page defines its own width/max-width independently — there is no shared `Container` component and no Tailwind `.container` class anywhere in the codebase.
2. **8 of 11 screens are hard-capped at `max-w-2xl` (~672px)**, regardless of viewport — Business, Fitness, School, Co-op, Insights, Weekly Planning, Settings, and (functionally) Deen. On any monitor wider than ~700px these render as a narrow centered column with large dead margins on both sides. Only Home uses real multi-column width (up to 1240px).
3. **A shell swap (top-nav → sidebar) is not a 1-file change.** Vertical padding logic is centralized (1 file), but horizontal width/padding is duplicated across **at least 19 files** (9 `page.tsx` + 8 matching `loading.tsx` skeletons + extra nested wrappers in Home and Deen) — all of these need touching regardless of what shell shape is chosen, since none of them currently deigns to the shell for width.
4. **No charting library is installed, and every existing "chart" is a hand-rolled `<div>` with inline `style` percentages** (conic-gradient rings, flex-bar sparkline, segmented-width bar) — zero SVG, zero `stroke-dasharray`, zero canvas anywhere in `components/`. A real chart library is a green-field decision, not a migration.
5. **Most chart-worthy data exists and is cheap to query**, but almost nothing is pre-aggregated for multi-day/multi-week ranges — every current lib function (`getWeeklySignalNoiseRatio`, `getFocusMap`, `calculateWeeklyConsistency`, `buildReflectionSparkline`) computes exactly one day or one week per call, not a range+bucket. Two genuine data gaps exist (see §3): no `completed_at` timestamp on tasks, and no timestamp on `deen_habits.archived`.

---

## 1. Shell & Layout Inventory

### Root layout — `app/layout.tsx`
`RootLayout` renders `<html>` → `<body className="min-h-full flex flex-col">` → `{children}` + `<RegisterSw />`. No width/padding/max-width classes, no `<main>`, no container, no nav — purely a document shell.

### App-group layout — `app/(app)/layout.tsx`
`AppLayout` handles auth/onboarding redirect gating only, then renders `<AppShell>{children}</AppShell>`. **No nested `layout.tsx` exists anywhere under `app/(app)/`** (confirmed via `find`) — every one of the 10 gated routes shares this single layout, no per-section override exists today.

### `components/shell/app-shell.tsx` (19 lines, full component tree)
```
<TopNav />
<main className="pt-0 pb-24 md:pt-14 md:pb-0">{children}</main>
<MobileIsland />
```
No providers, no other wrapper. `<main>` carries **only vertical padding** (clearing the fixed top-nav on desktop / bottom island on mobile) — **no width, max-width, or horizontal-padding class at all.** Horizontal layout is 100% delegated to whatever each page renders inside it.

### Where width is actually controlled — NOT centralized, 19+ independent sites

No shared `Container` component exists; no `.container` Tailwind class is used anywhere (`app/globals.css` defines no `.container` rule; Tailwind v4 CSS-first config, no `tailwind.config.*` file).

| File | Line | Class |
|---|---|---|
| `app/(app)/page.tsx` (Home) | 56 | `mx-auto grid w-full max-w-[1240px] ... px-4 py-8 md:py-12` |
| `app/(app)/page.tsx` | 70, 93 | two more nested `mx-auto w-full max-w-2xl` wrappers inside Home |
| `app/(app)/deen/page.tsx` | 124 | `mx-auto flex w-full max-w-4xl ... px-4 py-8 md:py-12` (outer) |
| `app/(app)/deen/page.tsx` | 125, 142, 157, 165 | 4 more nested `mx-auto w-full max-w-2xl` section wrappers (all sections except Habit Builder re-cap themselves narrower than the outer 4xl) |
| `app/(app)/business/page.tsx` | 75 | `mx-auto max-w-2xl ...` |
| `app/(app)/fitness/page.tsx` | 67 | same `max-w-2xl` pattern |
| `app/(app)/school/page.tsx` | 56 | same `max-w-2xl` pattern |
| `app/(app)/co-op/page.tsx` | 59 | same `max-w-2xl` pattern |
| `app/(app)/insights/page.tsx` | 72 | same `max-w-2xl` pattern |
| `app/(app)/weekly-planning/page.tsx` | 94 | same `max-w-2xl` pattern |
| `app/(app)/settings/page.tsx` | 18 | same `max-w-2xl` pattern |
| `app/(app)/onboarding/page.tsx` | 5 | own `<main>` element (nested inside AppShell's `<main>` — 2 `<main>` landmarks), `max-w-md` |
| `app/(app)/*/loading.tsx` × 8 | ~5-6 each | duplicate the sibling page's `max-w-2xl` pattern (business, co-op, deen [mismatched — deen's page is actually 4xl], fitness, insights, school, settings, weekly-planning) |
| `app/(app)/loading.tsx` | 6 | root-level loading skeleton, also `max-w-2xl` |
| `app/login/page.tsx` | 32 | `<Card className="w-full max-w-sm">` — outside `(app)` entirely |
| `app/signup/page.tsx` | 36 | same, `max-w-sm` |

**Distinct max-width values in play today:** `max-w-sm` (login/signup), `max-w-md` (onboarding), `max-w-2xl` (8 domain/utility screens + their loading skeletons + nested sections in Home/Deen), `max-w-4xl` (Deen's outer wrapper only — functionally overridden by its own inner `max-w-2xl` sections), `max-w-[1240px]` (Home's outer grid, a one-off arbitrary value used nowhere else).

**Implication for the shell-swap spec:** swapping top-nav → sidebar only requires touching the `pb-24 md:pt-14 md:pb-0` logic in one file. But fixing space utilization (the actual complaint) requires touching **width logic in ~19 files individually**, since nothing currently defers to a shared container. Centralizing width/padding into the shell (or a new shared `PageContainer` component every page adopts) should likely be part of the spec's foundation work, not a per-page afterthought — otherwise the sidebar refactor will just relocate the same narrow-column problem next to a sidebar instead of fixing it.

---

## 2. Per-Page Structural Shape

| Screen | Layout primitive | Max-width | # sections | Space usage note |
|---|---|---|---|---|
| **Home** | 3-rail CSS grid: `grid grid-cols-1 gap-6 ... md:grid-cols-[minmax(0,1fr)_280px] lg:grid-cols-[280px_minmax(0,1fr)_280px]` | `max-w-[1240px]` outer; center column further capped `max-w-2xl` | 5: left domain-peek rail (Deen/Business), hero+nudge+priority list, mobile peek carousel, weekly summary strip, right domain-peek rail (Fitness/School/Co-op) | **The only screen using real multi-column desktop width** — genuine 3-column grid up to 1240px |
| **Deen** | Single-column stack (`flex flex-col gap-8`) | Outer `max-w-4xl`, but 4 of 5 sections independently re-wrap in `max-w-2xl` (Habit Builder is the one exception, `w-full`) | 5: Salah rows, Qur'an card, Qada counter, Reflection tracker, Habit Builder | Narrow — the wider 4xl outer wrapper has no visible effect since inner sections undercut it to ~672px |
| **Business** | Single-column stack | `max-w-2xl` | 4: Lock In panel, kill list, weekly goal card, S:N ratio card | Narrow single column on any wide monitor |
| **Fitness** | Single-column stack | `max-w-2xl` | 4: habits + consistency StatCard, workout schedule + StatCard, workout week grid, ad-hoc workout form | Narrow single column |
| **School** | Single-column stack | `max-w-2xl` | 2: Tasks (+ Due Today StatCard), class schedule | Narrow single column |
| **Co-op** | Single-column stack | `max-w-2xl` | 2 (+ optional empty-state banner): tasks (+ StatCard), work schedule | Narrow single column |
| **Insights** | Single-column stack | `max-w-2xl` | 4: header + Day/Week toggle, Focus Map bar+legend, global S:N StatCard, per-domain ratio list | Narrow single column — worst offender given this is meant to be the chart-heavy analytics screen |
| **Weekly Planning** | Single-column stack | `max-w-2xl` | 2: "Last week" recap, "This week's goals" (2 GoalCards) | Narrow single column |
| **Settings** | Single-column stack | `max-w-2xl` | 3: prayer/location + check-ins form, PIN-lock form, static info panel | Narrow single column |
| **Onboarding** | Single-column, one step visible at a time | `max-w-md` | 1 visible (of 3 wizard steps) + install prompt | Narrowest of all — intentional for a modal-like wizard |
| **Login / Signup** | Centering flex (`flex min-h-screen items-center justify-center p-4`) | `Card` `max-w-sm` | 1: single auth Card | Narrow by design — appropriate for this screen type only |

**Pattern:** Home is the sole outlier with a genuine multi-column desktop layout. All 8 domain/utility screens are hard-capped at ~672px regardless of viewport — on a wide monitor they render as a narrow centered column with large unused horizontal margins either side. This is very likely the direct, mechanical cause of Ayman's "barebones/basic space utilization" complaint: Phases A–F restyled the components living inside these columns without ever widening the columns themselves.

---

## 3. Chartable Data Availability (no new schema)

Schema source of truth: `lib/supabase/database.types.ts` (no `supabase/migrations/*.sql` present in this checkout to cross-reference against).

| # | Metric | Data exists? | Existing aggregation fn? | Query cost |
|---|---|---|---|---|
| 1 | Prayer consistency, 7/30d, on-time/qada/missed per day | Yes — `prayers` table (`date`, `prayer_name`, `status`) | **No** — every current query is single-date only | Cheap (≤5 rows/day/user, single-table) |
| 2 | Qur'an pages/day/week over time | Yes — `quran_sessions` (`date`, `pages_read`) | **No** — `computeQuranStreak` discards `pages_read` entirely, only tracks streak dates | Cheap, same small table |
| 3 | S:N ratio trend across weeks | Yes — `checkins` (`checkin_time`, `tag_type`, `answered`) | **Partial** — `getWeeklySignalNoiseRatio(weekStart)` already takes an arbitrary week, proven by its use for "previous week" on Weekly Planning. **AWKWARD:** no bulk range+bucket query exists — an N-week trend means N separate round-trips today |
| 4 | Focus Map distribution shape | Yes — confirmed return type: `{ segments: { domain: string; pct: number }[]; globalRatio: string }` (`lib/insights/focus-map.ts`) | **Partial** — `getFocusMap(userId, range, anchor)` already accepts an arbitrary anchor date/range, but every current caller only ever passes `now` — no caller or helper builds a multi-period trend yet | Same AWKWARD N-round-trip caveat as #3 |
| 5 | Fitness habit consistency/day + workouts/week | Yes — `custom_habits`, `habit_logs`, `workout_logs` | **No** — `calculateWeeklyConsistency` returns one scalar for one week, no per-day breakdown, no multi-week loop | Cheap, small tables, `user_id` + date-range filter |
| 6 | Reflection tier counts over time | Yes — `reflection_entries` (`date`, `tier`) | **Partial** — `buildReflectionSparkline` exists and is exactly the precedent to reuse, but is **hardcoded to `DAYS_SHOWN = 7`** — needs parameterizing (or a sibling fn) for a 30-day view | Cheap to extend |
| 7 | Deen habit streaks / stage distribution | Yes — `deen_habits` (`committed_date`, `archived`), `deen_habit_logs` | **Yes for "today"** — `habitStage(committedDate, anyDate)` is a pure function, so a stage-distribution-over-time chart needs **zero new queries**, just calling it per historical day against already-fetched habits | **MISSING for the past**: `deen_habits.archived` has no timestamp, so which habits were "live" on a given past date can't be reconstructed once any habit has been archived (only non-archived habits are fetched at all) |
| 8 | Tasks completed vs. due over time | Partial — `tasks` (`due_date`, `completed` boolean) supports a **snapshot** ("due vs. completed as of today") | **No aggregation fn** | **MISSING for real trend**: no `completed_at`/`completed_date` column exists — `completed` is a plain boolean with no record of *when* it flipped. A genuine completions-per-day time series is not reconstructable without a schema change (out of scope per "no new migrations") |

**Bottom line:** almost every domain has cheap, real underlying data — the gap everywhere is a purpose-built range-aggregation query, not the data itself. The two genuine schema gaps (task completion timestamp, habit archive timestamp) are narrow and only block two specific chart ideas (#7 past-distribution, #8 completions trend) — everything else is buildable today.

---

## 4. Existing Chart/Visual Primitives

**No charting library is installed.** Full `package.json` dependencies confirm zero recharts/visx/chart.js/d3/nivo/apexcharts/victory — only `lucide-react` (icons), `radix-ui`/`shadcn` (UI primitives, not charts). Every existing "chart" in the app is Tailwind `<div>`s with inline `style` percentages — **zero SVG, zero `stroke-dasharray`, zero canvas anywhere in `components/`** (confirmed via grep).

- **Reflection-tracker 7-day sparkline** (`components/deen/reflection-tracker.tsx:72-87`) — 3 rows (one per tier), each a flex row of 7 `<div>` bars, `height` set via inline `style={{ height: `${Math.max(15, (day.counts[tier]/maxCount)*100)}%` }}`, color toggles `bg-foreground/30`/`bg-muted`. Fed by `buildReflectionSparkline` (`lib/deen/reflection-sparkline.ts`).
- **Home pulse rings** — two implementations, both single-ring **CSS `conic-gradient`** discs masked by an inner solid circle (donut via padding, not an SVG arc): `PulseStrip` (`components/home/pulse-strip.tsx:27-36`) and `PulseRing` inside `DomainPeekCard` (`components/home/domain-peek-card.tsx:17-26`). No animation/easing — just a `pct%` conic stop.
- **Insights Focus Map bar** (`app/(app)/insights/page.tsx:100-108`) — flex row of colored `<div>` segments, each `width: ${pct}%` inline, colors from a hardcoded `SEGMENT_COLOR` map, `rounded-full` container for free end-rounding. Legend is a separate `<ul>` of colored dots below it.
- **Other hand-rolled meters**: `ProgressBar` (`components/home/domain-peek-cards.tsx:52-59`, linear fill bar, currently hardcoded to the Deen accent color regardless of domain — worth generalizing); `PrayerDots` (same file, `:34-50`, categorical status dots per prayer).
- `--chart-1` through `--chart-5` tokens exist in the theme (`app/globals.css`) but are **currently unused** by any component — confirmed via grep.

**Conclusion:** a real chart library is a green-field addition, not a migration away from an existing one. Whatever's chosen should be evaluated against the existing conic-gradient/flex-bar patterns as prior art for interaction/visual language (e.g., the ring and segmented-bar patterns are worth preserving as a "quick glance" idiom even after a real chart library lands, rather than replacing every visual with a full chart).

---

## 5. Design Token Inventory

Tailwind v4 CSS-first config (no `tailwind.config.*` file) — `app/globals.css` uses `@theme inline { ... }` as pure indirection onto literal values defined in `:root`.

**`@theme inline` block** (`app/globals.css:7-55`) maps every Tailwind-facing token (`--color-*`, `--radius-*`, `--font-*`) onto a same-named CSS custom property with no literal values of its own — full list: background/foreground, 5 domain accents + info accent, sidebar tokens (8), chart tokens (5, unused), ring/input/border/destructive, accent/muted/secondary/primary (+foreground variants), popover/card (+foreground), and 7 radius steps (`sm` through `4xl`, all `calc()` off a single `--radius` base).

**Literal values** (`app/globals.css:63-111`, `:root`):
```css
--background: #0a0a0c;          --foreground: #f2efec;
--card: #131316;                --card-foreground: #f2efec;
--popover: #131316;             --popover-foreground: #f2efec;
--primary: #f2efec;             --primary-foreground: #0a0a0c;
--secondary: #1c1c20;           --secondary-foreground: #f2efec;
--muted: #1c1c20;               --muted-foreground: #9a9aa2;
--accent: #1c1c20;              --accent-foreground: #f2efec;
--destructive: #e85050;
--border: oklch(1 0 0 / 10%);   --input: oklch(1 0 0 / 15%);
--ring: #6a6a72;
--chart-1..5: oklch(0.87/0.556/0.439/0.371/0.269 0 0)  /* unused */
--radius: 0.625rem;
--sidebar*: mirrors card/primary/accent/border/ring above

/* Per-domain accents */
--accent-deen: #e0a030;         --accent-fitness: #e0a030;  /* NOTE: identical value */
--accent-business: #4caf7d;     --accent-school: #6aa9ff;
--accent-noise: #e85050;

/* General chrome accent — nav/focus rings/info badges/chart highlights,
   deliberately distinct from --accent-school to avoid confusion */
--accent-info: #5b8fd9;

/* Oxblood/ember glow, body radial-gradient layer */
--glow-oxblood: #2b0e13;
```

**Flag:** `--accent-deen` and `--accent-fitness` are literally identical (`#e0a030`) — worth confirming with the lead whether that's intentional shared-amber or a since-diverged decision that should get its own color, especially since the spec calls for "more diversity so it doesn't look robotic."

**`--glow-oxblood` usage** — applied exactly once, `app/globals.css:117-130`, as `body`'s `background-image: radial-gradient(ellipse 80% 60% at 50% -10%, var(--glow-oxblood) 0%, transparent 60%)`, `background-attachment: fixed`. A subtle top-anchored ember wash behind all page content; not referenced anywhere else in `components/`.

**Card/border/radius conventions** — 3 repeated patterns, no `rounded-xl`/`rounded-3xl`/`rounded-4xl` found in actual use despite those tokens existing:
1. **List-row item**: `rounded-lg border border-border/40 px-4 py-3` — e.g. `task-list.tsx`, `kill-list.tsx`, `prayer-row.tsx`, `habit-list.tsx`.
2. **Featured/hero card**: `rounded-2xl border p-4` + inline `style` using `color-mix(in oklch, var(--accent-X) 30%, transparent)` for border and a radial-gradient tint for background — e.g. `stat-card.tsx` (featured variant), `next-up-hero.tsx`, `domain-peek-card.tsx`, `lock-in-session.tsx`, `habit-builder.tsx`.
3. **Plain static card**: `rounded-2xl border border-border/40 bg-card p-4` — flat, no gradient — e.g. `settings-form.tsx`, `onboarding-wizard.tsx`, `goal-card.tsx`, `qada-counter.tsx`, `sn-ratio-card.tsx`.

---

## 6. Mobile Specifics

- **`MobileIsland`** (`components/shell/mobile-island.tsx:45`): `className="fixed inset-x-0 bottom-4 z-50 flex justify-center md:hidden"`. Floats 1rem off viewport bottom, `z-50`.
- **Compensating padding**: `pb-24` on `<main>` (`components/shell/app-shell.tsx:14`, mobile-only, removed via `md:pb-0`) is the **only** place compensating for the island's overlap — confirmed via grep, no other file adds matching bottom spacing.
- **Z-index tier**: `z-50` is shared with `TopNav` and with shadcn's `popover`/`dialog`/`select` primitives — MobileIsland sits at the same stacking tier as those, not above/below by explicit design; any tie would resolve by DOM/paint order.
- **Breakpoint**: confirmed `md:` (Tailwind default 768px) is the actual switch point in all three shell files — `top-nav.tsx` (`hidden ... md:flex`), `mobile-island.tsx` (`flex ... md:hidden`), `app-shell.tsx` (padding swap keyed to the same `md:` prefix). No `sm:`/`lg:` variants used for the nav switch anywhere.

---

## Audit methodology note
Gathered via 4 parallel read-only research agents (shell/layout+mobile, per-page structure, chartable data, visual primitives+design tokens) per the "no forked subagents" standing rule — non-fork `general-purpose` agents were used instead, each independently verifying file:line citations. No code was written or modified during this audit.
