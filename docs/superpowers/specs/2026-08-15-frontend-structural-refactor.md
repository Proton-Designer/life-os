# Frontend Structural Refactor — Design Spec

**Date:** 2026-08-15
**Status:** Approved by architect (Opus Lead). Direct user request with two reference images.
**Supersedes the layout decisions in:** `2026-08-15-visual-design-system-refresh.md` (that spec's *component* work — IconChip/StatCard/Badge/accent-info — stays and is built on; its *layout* assumptions are replaced).

## Brief (from Ayman)

The visual refresh (phases A–F) restyled components but never touched the shell or the grid. Result, in his words: the app still "looks barebones, basic, looks like it was vibe coded in an hour," with "terrible space utilization," weak organization, and "structure/layout clearly lacking."

Two reference dashboards supplied:
- **Ref A — "InsightX"**: persistent sectioned left sidebar, large page title + search + icon actions, a row of 3 *saturated tinted* KPI cards (icon chip · label · huge number · delta pill · caption line), a large area-chart panel with a comparison crosshair, and a right column of compact stat tiles above a donut breakdown with a value legend.
- **Ref B — "Overview"**: thin icon-only nav rail, big page title, search + user chip, a featured bar-chart card with a hero number + delta + segmented time-range control and **one bar highlighted in blue**, a month calendar widget, and a bottom three-up row (summary card w/ mini stat tiles + status badges, donut with center total + legend, list card with status badges and a "View all →" affordance).

Requirements: build an optimized/customized version of that frontend **specifically for this app**, across **every screen, desktop and mobile**. Keep the base color scheme (black + dark red/maroon glow and variants). Add *a little* blue accent. Add "more diversity so it doesn't look robotic."

## Root-cause diagnosis (why the current UI reads as barebones)

Not a styling problem. Six structural causes, in order of impact. Causes 1–2 were confirmed by a read-only codebase audit (`docs/audits/2026-08-15-frontend-structure-audit.md`).

0. **The mechanical root cause: 8 of 11 screens are hard-capped at `max-w-2xl` (~672px) regardless of viewport.** Business, Fitness, School, Co-op, Insights, Weekly Planning, Settings — and functionally Deen, whose `max-w-4xl` wrapper is undercut by four of its five sections re-capping themselves to `max-w-2xl`. Only Home uses real multi-column width. Phases A–F restyled what sat *inside* these columns without ever widening the columns. On a 1600px monitor these screens use 42% of the available width. **No amount of component polish can fix a 672px cap** — this alone explains most of "barebones / terrible space utilization."
   The corollary matters for sequencing: the shell applies *zero* horizontal constraint today (`AppShell`'s `<main>` sets vertical padding only), so width is duplicated across 9 `page.tsx` + 8 matching `loading.tsx` skeletons + nested wrappers — **~19 files**. Width must be centralized into a shared container as foundation work, or the sidebar refactor simply relocates the same narrow column next to a sidebar.
1. **The shell wastes the most valuable real estate.** A horizontal top nav consumes the full top band to show 6 links, then hands the page a narrow centered column. On a 2000px monitor content terminates at ~770px of 1118px vertical — roughly a third of the viewport is empty. A sidebar converts that wasted band into permanent, useful navigation.
2. **Three independent rails, no shared grid.** Home's left rail, center column, and right rail have unrelated heights and no baseline alignment, so nothing lines up. The references are strictly row-aligned grids.
3. **Cards don't earn their size.** "0 due today" and stop. Every reference card carries *four* layers: icon chip → label → big number → **a caption line explaining the why**. That caption is the single strongest "professional" tell, and we have zero of them.
4. **One elevation, one card treatment, everywhere.** Every card is `bg-card` flat. The references reserve saturated tinted fills for a hero KPI row and keep everything else quiet. Uniformity *is* the robotic feeling Ayman named.
5. **No data visualization at all.** Both references are chart-dense. We have five domains of genuine time-series data and render none of it.

Also surfaced: **Insights and Weekly Planning are not in the desktop nav at all** — there is no way to reach them except a deep link. The sidebar fixes this.

## Color architecture (validated, not eyeballed)

Base scheme is **unchanged** per the brief: `--background #0a0a0c`, `--card #131316`, `--foreground #f2efec`, `--glow-oxblood #2b0e13` body radial glow, `--accent-info #5b8fd9` as the sparing blue chrome accent.

### Two blocking defects found in the current tokens

`--accent-deen` and `--accent-fitness` are **the same hex** (`#e0a030`), and Co-op renders in School's blue. Harmless for badges on separate pages; **fatal** the moment domains become series in one chart (the Focus Map already puts all of them on screen together). Ran the palette validator: worst adjacent pair ΔE **0.0** — a hard fail on the normal-vision floor. Fitness and Co-op need their own hues.

### Ruling: brand tokens and chart series are separate roles

- **Brand accents** (badges, icon chips, borders, nav active states) keep their current character. Deen stays gold, Business green, School blue, Noise red.
- **Chart series** use a set re-stepped into the dark band (OKLCH L 0.48–0.67) and validated as a set. Same hue families, so the app still looks like itself.

### Validated chart series palette — `--series-*`

Canonical order, **which is the app's own urgency tie-break order** from the original design spec (Deen > Business > School/Co-op > Fitness). This is not arbitrary: series order and priority order are the same concept, so there is one order to remember.

| Slot | Domain | Dark step |
|---|---|---|
| 1 | Deen | `#c98500` |
| 2 | Business | `#199e70` |
| 3 | School | `#3987e5` |
| 4 | Co-op | `#d55181` |
| 5 | Fitness | `#9085e9` |
| 6 | Noise | `#e66767` |
| — | Other work | `#6a6a72` (neutral, exempt from the categorical gates) |

Validator, dark mode against the `#131316` card surface: lightness band **PASS**, chroma floor **PASS**, adjacent CVD ΔE **8.4 PASS**, adjacent normal-vision ΔE **19.7 PASS**, contrast **PASS**. All checks pass.

New brand tokens to add so badges/chips stop colliding: `--accent-fitness: #9085e9` (violet) and `--accent-coop: #d55181` (magenta). **This is the one place the brief's "keep the color scheme" is knowingly extended** — it is a correctness fix, not a re-theme, and it directly serves "more diversity so it doesn't look robotic." Deen keeps `#e0a030` as its brand accent (only its *chart* step differs).

### Chart form rulings — derived from the gates, not from the references

The reference images are chart-heavy and it is tempting to copy their donuts. Do not copy them blindly. A pie/donut/scatter compares **every** slice against every other, and all-pairs is a far harder gate than adjacent-pairs: even a professionally validated 8-hue palette clears all-pairs for only **3 slots**. Therefore:

| Data | Categories | Form | Why |
|---|---|---|---|
| **Focus Map** (time by domain) | 7 | **Ranked horizontal bars**, every bar direct-labeled | 7 slices cannot pass all-pairs at any ordering. Position carries identity; color becomes redundant reinforcement. Also fills horizontal space far better than a donut. |
| **Signal : Noise** | 2 | **Donut with center total** ✓ | Two slices pass trivially. This is the app's hero metric — it earns the reference's donut treatment. |
| **Prayer status over time** | 3, but **ordered** | **Consistency grid (heatmap)**, 5 prayers × N days | on-time → qada → missed is an ordered scale, not categorical; a donut is the wrong form regardless of color. Amber↔red measured 13.0 all-pairs (below the 15 floor), confirming it. |
| Qur'an pages, S:N by week, habit consistency | 1–2 series | **Area / line**, `--accent-info` highlight | Change over time. |
| Weekly totals w/ one period emphasized | 1 series | **Bar, single bar highlighted in `--accent-info`** | Directly mirrors Ref B's blue-highlighted bar — this is where the brief's blue accent lands most visibly. |
| Single completion fraction | 1 | **Progress ring** | Already exists as Home's pulse rings; generalize. |

Non-negotiables carried from the dataviz method: one y-axis ever (never dual-axis); legend present for ≥2 series with direct labels; color follows the entity, never its rank, so a filter that drops a series never repaints the survivors; text wears text tokens, never the series color; recessive grid and axes; thin marks, 2px lines, 2px surface gap between stacked segments; hover tooltip/crosshair on every plotted chart.

## Type

Keep Geist Sans (UI) + Geist Mono (numerics) — established, and a typeface swap is unjustified risk for a layout refactor. Tighten the scale so hierarchy carries the structure:

| Role | Spec |
|---|---|
| Page title | `text-3xl font-semibold tracking-tight` |
| Section label | `text-xs uppercase tracking-wider text-muted-foreground` |
| Card title | `text-sm font-medium` |
| **KPI hero value** | `text-4xl font-mono font-semibold tabular-nums` |
| Stat tile value | `text-2xl font-mono font-semibold tabular-nums` |
| Caption / "why" line | `text-xs text-muted-foreground` |
| Body | `text-sm` |

## The shell

Replaces `TopNav`. `MobileIsland` survives, unchanged in concept.

```
┌────────────┬──────────────────────────────────────────────────────────┐
│ ◈ Life OS  │  Home                        Fri, Aug 15   [◔] [◉] [av] │ 64px topbar
├────────────┼──────────────────────────────────────────────────────────┤
│ MAIN       │                                                          │
│ ▸ Home     │   ← page content, 12-col grid, gap-4, max-w-[1600px] →   │
│   Deen     │                                                          │
│   Business │                                                          │
│   Fitness  │                                                          │
│   School   │                                                          │
│   Co-op    │                                                          │
│            │                                                          │
│ REVIEW     │                                                          │
│   Insights │                                                          │
│   Weekly   │                                                          │
│            │                                                          │
│ SYSTEM     │                                                          │
│   Settings │                                                          │
├────────────┤                                                          │
│ [av] Ayman │                                                          │
└────────────┴──────────────────────────────────────────────────────────┘
  248px
```

- **Sections**: `MAIN` (Home, Deen, Business, Fitness, School, Co-op) · `REVIEW` (Insights, Weekly Planning) · `SYSTEM` (Settings). Section labels use the section-label type role.
- **Active item**: soft filled pill, tinted with that route's domain accent at ~14%, left icon in full accent, text at full foreground. Home/Insights/Weekly/Settings use `--accent-info`. This replaces the underline. Do **not** use Ref A's white-pill inversion — too loud against our near-black base and it fights the maroon glow.
- **Sidebar surface**: `--sidebar #131316` with a **very** subtle oxblood vertical gradient (top `--glow-oxblood` at ~35% → transparent by 40% height), echoing Ref A's maroon-tinted sidebar and tying the shell to our existing signature glow. `border-r border-border`.
- **Account block** pinned bottom: avatar, name, email truncated, overflow menu (Settings, Export data, Sign out).
- **Topbar**: page title left; right side gets today's date, a check-in/Lock-In status affordance, and the avatar. **No global search** — Ref A and B both have one, but this is a single-user app with nine screens and nothing to search; shipping a dead search field is exactly the templated-default move to avoid.

### Responsive

| Breakpoint | Shell |
|---|---|
| `≥1280px` (xl) | Sidebar expanded, 248px |
| `1024–1279px` (lg) | Sidebar collapsed to a **72px icon rail** (Ref B's treatment) — icons only, tooltip on hover, section labels become dividers |
| `<1024px` | Sidebar hidden. `MobileIsland` remains the primary nav; topbar gets a menu button opening the full sidebar as a slide-over drawer (this is how Insights/Weekly/Settings become reachable on mobile) |

Content container: `max-w-[1600px] mx-auto px-6 xl:px-8`, grid `grid-cols-12 gap-4 xl:gap-5`.

## Card taxonomy — the anti-robotic mechanism

Four tiers. **Diversity comes from deliberately unequal treatment, not from decorating everything.** Restraint rule: at most 3–4 Tier-1 cards per screen, top row only. Everything else is Tier 2/3.

**Tier 1 — Featured KPI card.** The reference's saturated tinted card. `rounded-2xl`, background = domain accent at ~10% over `--card` plus a soft radial wash from the top-left in that accent, `border border-<accent>/25`. Contents, in order: icon chip · label · **hero value** (mono) · delta pill · **caption line**. Fixed `min-h-[168px]` so a row of them aligns exactly.

**Tier 2 — Panel.** `rounded-2xl border border-border/40 bg-card`. Holds charts, lists, forms. Header row: title left, controls right (segmented control / dropdown / "View all →").

**Tier 3 — Compact stat tile.** `rounded-xl border border-border/40 bg-card p-4`. Icon chip · label · value · delta. Used in clusters of 2–4 inside or beside panels.

**Tier 4 — List row.** Inside panels. Leading marker (checkbox / domain chip), label, trailing badge + meta. `divide-y divide-border/40`, hover `bg-foreground/[0.03]`, `min-h-[52px]`.

**The caption line is mandatory on every Tier 1 card.** This is the highest-leverage single change in the whole refactor. It converts a number into an insight and is the main thing separating the references from our current cards. It must be *derived*, never static filler:
- `3 of 5 on time — Asr was 40 min late`
- `Kill list 1/3 — 2 left, 4h of focus time remaining today`
- `Best week in 3 — up 12 pages from last week`
- Empty state: `Nothing logged yet — start with Fajr` (an invitation to act, never "No data")

**Empty states get the same treatment as populated ones.** Today every zero renders as a dead `0` or `No data`. Every empty card must instead show a muted illustration-weight glyph, one line of what would go here, and a primary action. An empty screen is an invitation to act.

## Signature element — the Day Ribbon

Every reference's hero is a generic analytics chart. Ours should encode what this app actually *is*: a day shaped and punctuated by the five prayers. The Day Ribbon is the one thing this dashboard will be remembered by, and it is not portable to any other product.

A full-width horizontal band on Home, spanning **Fajr → Isha at their true computed times** for today (we already compute these locally in `lib/prayer-times/calculate.ts`):

```
Fajr        Dhuhr           Asr        Maghrib      Isha
 ●───────────●───────────────●────────────○───────────○
 5:12       12:56          4:49    ▲     7:59       9:40
                                  now
 ▓▓▓▓░░░░  ▓▓▓▓▓▓▓▓▓  ░░░░░░░░░░░░
 └ logged activity blocks (check-ins, Lock-In sessions, workouts)
```

- Prayer markers at true horizontal position; filled = logged, hollow = upcoming, ringed = missed.
- A live **"now" indicator in `--accent-info`** — the most visible, most justified use of the brief's blue accent.
- Beneath, today's logged activity as blocks positioned by real timestamp, tinted by domain series color (`checkins.created_at`, `work_sessions.started_at/ended_at`, workout logs).
- Hovering a block shows what it was. Clicking a prayer marker marks it.

It fills the wide horizontal space the current layout wastes, replaces the weak flat "Later today" list with something spatial, and is genuinely specific to this subject.

## Per-screen layout maps

All grids are 12-column. `c-N` = column span at `xl`. Below `lg` everything stacks to a single column unless noted.

### The one-metric rule (governs every map below)

Review of the first draft found the same defect on four screens: a KPI card and a panel showing the same number in two places — Business rendered Signal:Noise **three** times on one screen. Cause: KPI rows were composed mechanically as "one card per domain" instead of from what each screen actually needs.

**Rule: if a screen has a panel for a metric, that number lives in the panel's own header, next to the detail it summarizes. The KPI row carries only metrics that have no panel on that screen.** A panel header may carry a hero value, a delta, and a caption — that is the reference dashboards' actual pattern (hero number top-left, chart beneath, in one card), and it beats splitting a number away from the thing it describes.

This also gives the KPI row a real job rather than a decorative one: on a domain page it is the **standing row** — trend, streak, and backlog metrics answering *"how am I doing overall"* — while panels answer *"what's happening today."*

### Home
| Row | Content |
|---|---|
| 1 | **Day Ribbon** panel, `c-12` (the signature; replaces "Later today" as the day's spine) |
| 2 | **Tier-1 KPI row ×4**, `c-3` each — all **cross-cutting**, never per-domain (the domain stack in row 3 owns per-domain status): *Next Up* (hero = prayer/task + countdown, primary action inline) · *Today's completion* (items done across all domains) · *Focus time today* · *Prayer streak* |
| 3 | **Right Now / Later Today** action list panel `c-7` · **Domain status stack** `c-5` (5 compact rows, each: icon chip, domain, one live metric, progress ring, → link) |
| 4 | **This week trend** area chart `c-8` (completion over 7 days, segmented Week/Month control) · **Signal:Noise donut** `c-4` (Home's only S:N treatment) |

### Deen
| Row | Content |
|---|---|
| 1 | KPI ×3, standing metrics with no panel below: *Next prayer* (countdown + one-tap mark) · *Prayer streak* · *Qada backlog* (trend caption) |
| 2 | **Salah today** featured panel `c-5` — header hero `3/5` + caption naming the gap, then the 5 interactive On-time/Qada/Missed rows. *(Was split into a "Today's prayers" KPI plus a separate rows panel; merged — the count and the rows belong together.)* · **Prayer consistency grid** `c-7` (5 × 30-day heatmap, header hero = on-time rate over the window) |
| 3 | **Qur'an** panel `c-6` — header hero = pages this week vs target + delta, **trend chart beneath in the same card**. *(Was a "Qur'an this week" KPI in row 1 and a separate pages chart in row 3 — same subject read twice, in two places.)* · **Habit Builder** stage columns `c-6` (Active Build / Stabilized / Locked, badge per habit) |
| 4 | **Reflection** panel `c-12` — three tier tallies + existing 7-day sparkline, upgraded to the shared chart primitive. **Privacy is a hard constraint: no sin/severity language in text, aria-labels, tooltips, or chart legends.** Keep the abstract ○/◐/● tiers. |

### Business
| Row | Content |
|---|---|
| 1 | KPI ×3, standing metrics with no panel below: *Focus time today* (total from Lock-In sessions, shown whether or not one is running) · *Sessions this week* · *Days kill list cleared, last 7* |
| 2 | **Lock In** featured panel `c-7` — when active, live timer as hero value, session S:N, session check-in list; when idle, the start action and the last session's summary · **This week's goal** panel `c-5` — headline + milestones from Weekly Planning, editable inline. *(These were previously crammed into one "S:N donut + weekly goal" cell — two unrelated things bundled to fill a slot. Layout now follows content.)* |
| 3 | **Kill list** panel `c-6` (header hero `1/3`, then Tier-4 rows, order preserved) · **S:N by week** bar chart `c-6` (header hero = this week's ratio + delta; current week highlighted in `--accent-info`) |

**Signal:Noise appears exactly once on Business** — as the by-week chart, which carries the current ratio in its header. The donut is removed from this screen; it lives on Insights, the analytics screen. The first draft had S:N in three places (a KPI, a donut, and the bar chart).

### Fitness
| Row | Content |
|---|---|
| 1 | KPI ×3, standing metrics with no panel below: *Today's workout* (scheduled type or Rest, with the log action inline) · *Current streak* · *Workouts this month* |
| 2 | **Habit consistency grid** `c-7` (habits × 30 days, same primitive as Deen's prayer grid; header hero = weekly consistency %) · **This week's schedule** `c-5` (7-day column strip, today emphasized; header hero = `X/5 scheduled`) |
| 3 | **Habits** list panel `c-6` · **Workouts per week** bar chart `c-6` |

### School / Co-op (same layout, different domain accent + data)
| Row | Content |
|---|---|
| 1 | KPI ×3, standing metrics with no panel below: *Due today* · *Overdue* · *Completed this week* (needs `tasks.completed_at`) |
| 2 | **Week schedule** `c-8` (7-day grid, today's column emphasized, per-occurrence cancel preserved) · **Upcoming deadlines** `c-4` (header hero = count due this week, then Tier-4 rows w/ urgency badges) |
| 3 | **Task list** panel `c-12`, grouped by due window (header hero = open task count) |

Co-op's empty state (`No active co-op`) becomes a proper Tier-2 empty panel with an action, not a bare line.

### Insights
| Row | Content |
|---|---|
| 1 | KPI ×3, standing metrics with no panel below: *Check-in coverage* (answered / fired) · *Most-focused domain* · *Noise share vs last week* |
| 2 | **Focus Map — ranked horizontal bars** `c-8`, direct-labeled, Day/Week toggle as a segmented control · **S:N donut** `c-4` — **the global ratio is the donut's center total**, not a separate KPI card (a donut has a center; that is where its number belongs) |
| 3 | **Per-domain breakdown** `c-12` — one Tier-4 row per domain: icon chip, name, ratio, inline mini bar. Keep the existing `?domain=` highlight, with the accent bug fix already landed in the prior phase. |

### Weekly Planning
| Row | Content |
|---|---|
| 1 | **Last week recap** `c-12` — 4 Tier-3 stat tiles in a row + a sparkline each, replacing the current prose recap |
| 2 | **Deen goal** `c-6` · **Business goal** `c-6` (existing `GoalCard`, upgraded to Tier-2 panel with domain icon chip) |
| 3 | **Week-over-week trend** `c-12` — small multiples, one sparkline per tracked metric |

### Settings
Two-column at `xl`: sticky section nav `c-3` (Profile · Prayer · Check-ins · Security · Data) + content `c-9`. Currently one long stack wasting the full right half.

### Onboarding / Login / Signup
Keep centered — correct for these. Apply the Tier-2 panel treatment and the sidebar's oxblood gradient as the page backdrop so they feel part of the same system. Onboarding keeps its existing step card + progress bar.

## Mobile (<1024px) — first-class, not a reflow afterthought

Every screen must be designed at 390px, not merely not-broken.

- **Nav**: `MobileIsland` stays primary; topbar menu button opens the full sidebar as a drawer.
- **KPI rows** become a horizontally scrollable snap carousel (`snap-x snap-mandatory`, cards at ~78vw so the next one peeks) — the pattern already proven on Home's peek cards.
- **Charts**: full-width, reduced height (`h-40`), fewer x-ticks, tap-to-inspect instead of hover.
- **Day Ribbon**: horizontally scrollable, auto-scrolled to center "now" on mount.
- **Consistency grids**: show 14 days instead of 30, horizontally scrollable.
- **Bottom padding**: every page needs clearance for the floating island — verify against its real height, do not guess.
- Tap targets ≥44px. Tier-4 rows already meet this at 52px.

## Quality floor (non-negotiable, applies to every phase)

- Responsive with **zero horizontal overflow** at 390 / 768 / 1024 / 1280 / 1600px — measured via `scrollWidth` vs `clientWidth`, never eyeballed.
- Visible keyboard focus on every interactive element (`--accent-info` ring). Sidebar and drawer fully keyboard navigable; drawer traps focus and closes on Escape.
- `prefers-reduced-motion` respected — chart entrance animations and the drawer transition must degrade to instant.
- Charts: legend for ≥2 series, direct labels, a text alternative for screen readers (a visually-hidden table or `aria-label` summarizing the series).
- No layout shift when data loads: skeletons must match final card dimensions.

## Motion

Restrained and purposeful. A short staggered fade-and-rise on dashboard cards at page load (~40ms apart, ≤240ms total), chart paths drawing once on mount, and hover lifts on interactive cards. Nothing ambient, nothing looping — scattered animation is itself an "AI-generated" tell.

## Self-critique against generic-dashboard defaults

The nearest failure mode is the AI-design cluster of *near-black + one bright accent* — and a sidebar dashboard with a KPI row is the single most templated layout in existence. Mitigations, deliberately chosen:

1. **The five-domain accent system stays the primary differentiator**, not one hero accent. Blue is strictly secondary chrome.
2. **The maroon/oxblood glow is unique to this app** and is now carried into the sidebar as well, so the shell reads as ours rather than as a stock admin template.
3. **The Day Ribbon replaces the stock hero chart** — prayer-anchored time is not portable to any other product.
4. **Two reference elements were deliberately rejected**: the global search field (nothing to search in a nine-screen single-user app) and the multi-slice donut (fails the color gates and is the wrong form for ordered data). Copying them would have been the templated move.
5. **Consistency grids** — prayer and habit — are dense, characteristic, and specific to a practice-tracking app rather than a sales dashboard.

## Build order

Each phase is fully lead-verified — code review, re-run tests, live Playwright screenshots at desktop **and** mobile — before the next begins.

| Phase | Scope |
|---|---|
| **A** | Tokens + shell + **width centralization**. `--series-*`, fix `--accent-fitness`/add `--accent-coop`; `AppSidebar` + `Topbar` + `AppShell` rewrite, icon-rail + drawer. **Introduce a shared `PageContainer`/`PageHeader` and strip the per-page `max-w-*` caps from all 9 `page.tsx`, all 8 `loading.tsx` skeletons, and the nested wrappers in Home/Deen** — width becomes a shell concern, owned in one place. Without this the sidebar just relocates a 672px column. Every page still renders and every route reachable at the end of the phase. |
| **B** | Card system. `KpiCard` (Tier 1, w/ caption + delta pill), `Panel`, `StatTile`, `ListRow`, `SegmentedControl`, `EmptyState`. Extend existing `StatCard`/`Badge`/`IconChip` rather than forking them. |
| **C** | Chart primitives, TDD'd on pure data-shaping helpers: `AreaChart`, `BarChart` (w/ highlight), `DonutChart`, `Sparkline`, `ProgressRing`, `ConsistencyGrid`, `RankedBars` + a shared axis/tooltip/legend layer. Hand-rolled SVG — **no new dependency** (precedent: the existing reflection sparkline). |
| **D** | **Day Ribbon** (the signature) + Home rebuilt to its layout map. |
| **E** | Deen + Business to their layout maps. |
| **F** | Fitness + School + Co-op. |
| **G** | Insights + Weekly Planning + Settings + auth/onboarding backdrop. |
| **H** | Full mobile pass at 390px across all screens, then full regression: unit + tsc + lint + build + E2E, overflow measurement at all 5 breakpoints, deploy, live production verification. |

Data-layer work (new aggregation queries for the charts) lands in the phase that first needs it, TDD'd with an injected data source, matching the established `getPriorityItems` / `getWeeklySignalNoiseRatio` pattern.

## Data-layer notes (from the audit)

Every existing aggregation helper computes exactly **one** day or week per call. Multi-period trends must not be built by looping those helpers — that is N round-trips per chart. Each trend gets a **single bulk range query + in-memory bucketing**, with the bucketing logic extracted as a pure, TDD'd function and the query injected, so the maths is testable without a network client.

Buildable today with no schema change: prayer consistency per day, Qur'an pages per day, fitness habit consistency per day, reflection tier counts per day, Focus Map over a range, S:N per week.

Two narrow gaps, both real:
- **`tasks` has no `completed_at`** — blocks any "tasks completed over time" trend, including School/Co-op's row-1 *Completed this week* KPI. **Ruling: add it.** A nullable `timestamptz`, set on completion, additive and non-breaking — the smallest possible migration, and the KPI is load-bearing in the layout map. Historical rows stay null and are simply absent from the trend; do not backfill a fabricated date.
- **`deen_habits.archived` has no timestamp** — past habit-stage distribution can't be reconstructed once a habit is archived. **Ruling: do not fix now.** No layout in this spec depends on historical stage distribution; current-stage distribution works fine. Note it and move on rather than widening scope.
