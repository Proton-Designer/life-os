# Class schedule + week calendar + UI fixes — spec (Engineer B + C)

**Scope authority:** `docs/superpowers/specs/2026-08-23-overnight-session-REQUIREMENTS.md`.

**Ayman is asleep. No questions to him — route everything to the Opus Lead.**

---

## PART ONE — Engineer B

### 1. Migration `042_schedule_events_detail.sql`

`schedule_events` already exists and the School page already reads it. It
carries only a single `event_time` and no detail fields, which is not enough
to place a class as a BLOCK on a timeline or to answer "all the necessary
information when you click on the class."

```sql
alter table schedule_events add column end_time time;
alter table schedule_events add column location text;
alter table schedule_events add column instructor text;
```

Additive and nullable — every existing reader keeps working untouched.

### 2. Seed script — `scripts/seed-schedule.ts`

**Idempotent**, takes an email, resolves the user, upserts on
`(user_id, title, day_of_week)`. Running it twice must not duplicate rows.
It is a script, NOT a migration — this is one person's timetable, not schema,
and it must never run against an unrelated account by default.

Classes (`domain = 'school'`, `is_recurring = true`; `day_of_week` 0=Sun):

| Title | Location | Instructor | Days | Start | End |
|---|---|---|---|---|---|
| CS-3341-HON | ECSN 2.120 | Nicholas Robert Ruozzi | Mon, Wed | 08:30 | 09:45 |
| CS-3345-HON | FO 2.404 | Andrew Schmidt Nemec | Tue, Thu | 10:00 | 11:15 |
| PHYS-2326-002 | SCI 1.220 | Mengke Liu | Tue, Thu | 13:00 | 14:15 |
| PHYS-2126-105 | SCI 1.169 | Lamya Saleh, Paul J. Macalevey | Wed | 13:00 | 15:45 |
| AMS-2341-HN1 | AD 2.238 | Erin Smith | Tue, Thu | 16:00 | 17:15 |

Work (`domain = 'co_op'`, `is_recurring = true`, title `Work`):

| Day | Start | End |
|---|---|---|
| Monday | 10:30 | 17:30 |
| Wednesday | 16:30 | 18:00 |
| Friday | 07:30 | 17:30 |

Run it for **both** the SEED account and Ayman's real account. Ayman's rows
are explicitly PRESERVED by tonight's data wipe (see the REQUIREMENTS file's
ruling) — the wipe clears recorded activity, not schedule scaffolding.

There are no class/work time conflicts in the above; if your conflict check
reports one, you have a bug.

### 3. School page — the class schedule section

`app/(app)/school/page.tsx` gains a schedule panel: the week's recurring
classes grouped by day, each showing time range, room, and instructor.
Respect `cancelled_on`. Today's classes are visually distinguished.

### 4. "The day's shape" — classes on the timeline

`lib/home/get-day-shape.ts` already assembles `RibbonActivityInput[]` and
`lib/home/day-ribbon.ts` already positions them as `RibbonActivityBlock`s.
Classes are a new activity source, not a new mechanism.

- Add a `getScheduleEvents` data source reading today's recurring +
  one-off `schedule_events`, and push a block per event. Use the real
  `end_time` when present; only fall back to a nominal duration when it is
  null (and keep the existing `NOMINAL_*` comments honest about which is which).
- `colorVar`: `--series-school` for classes, `--series-coop` for work.
- **Blocks must become clickable.** Extend `RibbonActivityInput` and
  `RibbonActivityBlock` with an optional
  `detail?: { title: string; timeRange: string; location?: string; instructor?: string; domain: string }`.
  Clicking a block opens a small popover/dialog with that detail. Blocks with
  no detail (focus sessions) stay non-interactive — do not render a dead
  affordance.
- `pctOf` stays private to `day-ribbon.ts`. Do not export it.

### 5. Weekly goals — one shared component, two homes

Ayman: *"right now its kind of just like colored text but it should be a
little more put together and structured/formatted/beautified to indicate and
clearly display the two goals and make this distinct so the user knows what
is deen what is business."*

Build `components/shared/weekly-goals-header.tsx`: two clearly separated,
labelled cards — an explicit **DEEN** / **BUSINESS** eyebrow label on each,
the domain icon via `DOMAIN_ICON`, the accent via `DOMAIN_ACCENT`, the goal
headline as real content rather than a coloured link. Empty slots keep a
distinct "set this week's goal" affordance. The current failure is that
colour is the ONLY signal of which goal is which — the label must be
explicit, not inferred from a tint.

Use it in two places: the top of Home (replacing `weekly-goal-strip.tsx`'s
presentation) and the top of the new calendar route.

### 6. `/calendar` route + topbar button

Replace the user profile icon at the top RIGHT of the topbar with a
**calendar** button linking to `/calendar`.

> **Ownership:** `components/shell/topbar.tsx` belongs to **Engineer A**
> tonight (they are adding the Distractions and Review buttons to the same
> file). Do NOT edit it. Build the route; A adds the link. A three-way edit
> of one 70-line file is how we lose an hour to conflicts.

Note this removes the only path to the account/sign-out UI in the top bar.
`AccountBlock` still renders in the mobile drawer and the `lg+` sidebar, so
sign-out survives — verify that in a browser and report it, do not silently
strand it.

`/calendar` renders **this week, Sun–Sat, as an hour grid**:
- Classes and work from `schedule_events`
- Workouts/sessions from the fitness plan tables (`plan_sessions` +
  `workout_schedule`)
- Deadlines / due dates from `tasks` across every domain
- The weekly goals header from §5 pinned at the top

Reuse the fitness `HourlyWeekCalendar` if it fits; if adapting it costs more
than a purpose-built grid, write the grid and say so. Do not fork it and
leave two near-identical calendars — tell the Lead which way you went.

---

## PART TWO — Engineer C

### 7. Deen — monthly reflection calendar

Replace the horizontal 30-day strip under the Reflection module with a
**full month calendar**. Each day cell:
- Background shaded by that day's weight — heavier ⇒ darker red. Reuse
  `dayWeight`/`bucketForWeight` from `lib/deen/reflection-strip.ts`; do not
  invent a second scale.
- Inside the cell, the per-tier counts: `Light: n`, `Moderate: n`, `Heavy: n`.
  Zero-count tiers may be dimmed but the day's total must be readable at a glance.
- Today is marked. Future days in the current month render empty, not "clear."
- Keep the existing "today isn't over yet" rule from `buildReflectionStrip` —
  an empty in-progress today must not be painted as a clean day.

New pure lib `lib/deen/reflection-month.ts` with unit tests: month boundaries,
a month starting on Sunday, a month starting on Saturday, an empty month, and
a leap-year February.

### 8. Habit Builder

`components/deen/habit-builder.tsx`:
- Replace the "Pick this week's focus habit" section at the top with a simple
  **Create New Habit** button.
- In the last-30-days grid, add the dates subtly along the top — **one row of
  labels above the columns**, each column reading down from its date. Not a
  label per square.

### 9. Prayer consistency grid

Same date-label treatment on the prayer consistency graph.

Both grids render through `components/charts/consistency-grid.tsx`. Add an
**optional, backward-compatible** prop (e.g. `showDateLabels?: boolean`) —
that component is shared, and every existing caller must render exactly as it
does today when the prop is absent.

---

## Constraints (both engineers)

- **RSC boundary** (`AGENTS.md`): never pass a plain function from a Server to
  a Client Component. Server Actions survive via `.bind(null, arg)`. Neither
  `tsc` nor vitest catches this — check a real browser console.
- **Timezone**: every calendar date via `localDateString(now, profile.timezone)`.
  Never UTC. This class of bug has shipped twice here.
- **Shared working tree.** `git diff HEAD -- <path>` on EVERY file before
  staging. Full unfiltered `git status --short`, never a grep. Pathspec-limit
  every commit. Never `git add -A`, never `git stash`, never `reset --hard`.
- **`app/(app)/page.tsx` is shared tonight**: B owns the weekly-goals region,
  C owns the Focus panel region. Diff before staging, every time.
- **`database.types.ts` is serialized through the Lead.** Ping before regenerating.
