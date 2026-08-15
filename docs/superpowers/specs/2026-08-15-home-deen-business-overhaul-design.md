# Home / Deen / Business Overhaul — Design Spec

**Status:** Approved by architect (Opus Lead) under explicit user-granted creative autonomy. Kicked off overnight 2026-08-15 while the user (Ayman) is asleep/unreachable — **no clarifying questions permitted this run; every judgment call is made and documented here.** This spec is the source of truth for the Sonnet Engineer's implementation; do not wait for further sign-off.

## Why

Ayman's ask, condensed from his own words:
1. Home screen is sparse and wastes desktop width (content is a centered strip on every screen). It should be genuinely useful — top action items up front, plus at-a-glance peeks into every domain — and should reflow cleanly across monitor / 14" laptop / tablet / mobile, not just "work" at each size.
2. Deen: drop Traveling and Adhkar from the UI (for now). Add a private self-accountability tracker (3 severity tiers, meaning legible to Ayman only, opaque to anyone glancing at the screen). Add a habit-builder pipeline (weekly focus → active build → stabilized → locked).
3. Business: replace the app-wide 2-hour check-in scheduler with a Business-scoped "Lock In" work session — press it, a timer starts, an hourly progress-check fires *only while locked in*, and the session shows a live signal:noise readout that still rolls up into the existing weekly S:N ratio.

## Global constraints
- No destructive schema changes. `traveling_mode`, `adhkar_logs`, `checkin_window_start/end`, `checkin_interval_minutes` stay in the DB, just unused by new UI — reversible, no data loss.
- `checkins` table (142 real rows) and `getWeeklySignalNoiseRatio` stay wired exactly as-is; new Business check-ins are additive rows in the same table so Insights keeps working untouched.
- Reuse existing utilities rather than reinventing them: `getWeekStartDate`/`localDateString` (`lib/date-utils.ts`), `getDomainPulse` (`lib/home/get-domain-pulse.ts`), the `custom_habits`/`habit_logs` pattern as the template for the new Deen habit tables, the `computeCheckinSlots` polling pattern as the template for the Lock-In hourly prompt.
- Every new/changed screen must be responsive with no fixed pixel widths — Tailwind breakpoints, fluid grids, `max-w` + `mx-auto` only where it genuinely bounds line length (peek cards, not the whole page on desktop).
- TDD per existing project convention. Every phase ends with: unit tests green, `tsc --noEmit` clean, `npm run lint` clean, then a live Playwright pass against `npm run dev` before moving to the next phase.

---

## Part 1 — Database schema (Phase 1, blocking everything else)

### 1a. Private accountability tracker
Table `reflection_entries`:
- `id uuid pk default gen_random_uuid()`
- `user_id uuid` (fk auth.users, default `auth.uid()`)
- `date date`
- `tier int check (tier in (1,2,3))` — 1 = discouraged/disliked habit, 2 = minor shortcoming, 3 = more severe
- `created_at timestamptz default now()`
- RLS: `user_id = (select auth.uid())`, indexed on `user_id`.
- No `text`/`note` column — this is a tally, not a journal. Deliberate: the moment it stores freeform text, a glance at the screen while a note is expanded could leak content. Tally-only keeps it opaque by construction, not just by UI styling.

### 1b. Deen habit builder
Table `deen_habits`:
- `id uuid pk`, `user_id uuid`, `name text`, `committed_date date` (day it entered Active Build), `archived boolean default false`, `created_at timestamptz default now()`.

Table `deen_habit_logs`:
- `id uuid pk`, `habit_id uuid fk deen_habits`, `user_id uuid`, `date date`, `completed boolean default false`.
- Mirrors `custom_habits`/`habit_logs` exactly — same shape, same RLS pattern, same cascade-on-delete via FK.

Table `deen_weekly_focus`:
- `id uuid pk`, `user_id uuid`, `week_start_date date`, `habit_id uuid fk deen_habits`, `created_at timestamptz default now()`.
- One row per week (unique on `user_id, week_start_date`), upserted when the focus is (re)picked.

**Stage derivation is computed, not stored** (avoids a second source of truth that can drift): given `committed_date` and today,
`daysSinceCommitted = today - committed_date`. `0–13` → Active Build, `14–29` → Stabilized, `30+` → Locked. This is a pure function (`lib/deen/habit-stage.ts`), unit-testable with fixed dates, same DI-friendly style as `urgencyBucket`. Streak (consecutive completed days, walking backward from today through `deen_habit_logs`) is computed and shown alongside stage as a supporting stat — it does **not** gate promotion. Judgment call: gating promotion on an unbroken streak would mean one missed day permanently resets months of progress, which is demotivating and not what "stabilized" should mean for a habit-forming tool. Elapsed-time-since-commit is the promotion signal; streak is informational.

### 1c. Business Lock-In sessions
Table `work_sessions`:
- `id uuid pk`, `user_id uuid`, `started_at timestamptz`, `ended_at timestamptz nullable`, `created_at timestamptz default now()`.
- "Active" = `ended_at is null`. At most one active session per user is an application-level invariant (enforced in the Server Action, not a DB constraint — simplest correct approach for a single-user app).

Migration on `checkins`: add nullable `work_session_id uuid fk work_sessions`. Existing 142 rows get `null` (they predate sessions — correct, they weren't part of one). New Business hourly check-ins set it; the weekly S:N query (`lib/business/sn-ratio.ts`) is untouched and keeps summing by `tag_type`/`answered` regardless of session — `work_session_id` is purely additive, used only by the new live-session view to scope "this session's checks."

All new tables: RLS `user_id = (select auth.uid())`, FK-column indexes — matching the `supabase-postgres-best-practices` pattern already established in migration `001`.

---

## Part 2 — Business: Lock In

Remove: `CheckinSchedulerLoader`/`CheckinScheduler` from `AppShell` (components/shell/app-shell.tsx) — the global 2-hour prompt goes away entirely, everywhere in the app.

Add, scoped to `app/(app)/business/page.tsx` only:
- **No active session:** a prominent "Lock In" button. Pressing it calls a new Server Action `startWorkSession()` (inserts `work_sessions` row, `started_at = now()`), then the page shows the active-session view (via client state + `router.refresh()` or optimistic local state — engineer's call which is cleaner given the existing focus-refresh regression lesson: prefer local client state over any refresh-based approach).
- **Active session:** a client component `LockInSession` (new, `components/business/lock-in-session.tsx`) showing:
  - Live elapsed timer (client-side `setInterval` tick, same pattern as `checkin-scheduler.tsx`'s existing 60s poll — no server round-trip needed for a clock).
  - Every 60 real minutes since `started_at` (not wall-clock hour boundaries — session-relative), fire the same `CheckinPrompt` UI already built (`components/checkin/checkin-prompt.tsx`), reusing `answerCheckin`/`recordMissedCheckin` but with `work_session_id` set. Model this scheduling exactly on `computeCheckinSlots`, just with a session-relative window (`started_at` → now, unbounded end) instead of a fixed daily clock-time window — extract or parallel that function as `computeSessionCheckinSlots(startedAt, intervalMinutes, now, answeredTimes)` in `lib/checkins/`.
  - A running list of this session's fired prompts and their answers (signal/noise/other, or "missed").
  - Live signal:noise for *this session only* (reuse `computeRatioDisplay` from `lib/insights/ratio-display.ts` against the session's own answered checkins — don't touch `getWeeklySignalNoiseRatio`, it already aggregates correctly across all checkins including these new ones).
  - An "End session" button calling `endWorkSession()` (sets `ended_at = now()`).
- If the user closes the tab mid-session and comes back later, the active session (if any) is loaded server-side in `BusinessPage` and handed to `LockInSession` as initial state — sessions persist across reloads/devices by design (it's a DB row, not client-only state).

---

## Part 3 — Deen page changes

Remove the `<section>` blocks for Adhkar and Traveling from `app/(app)/deen/page.tsx` (and their imports `AdhkarStrip`/`TravelingToggle`). Leave `components/deen/adhkar-strip.tsx` and `traveling-toggle.tsx` files in place, untouched, just unreferenced — trivial to bring back later, per "remove for now."

Keep, unchanged: Salah section, Qur'an section, Qada backlog section.

### New: private accountability tracker ("Reflection")
Section title: **"Reflection"** — reads as a generic self-review widget to anyone glancing at the screen. No tier is ever labeled "sin," "discouraged," "minor," or "severe" anywhere in the UI, copy, or accessible names visible at a glance.

Layout: three tally boxes in a row, differentiated only by a filled-dot intensity glyph (○ / ◐ / ●) and a numeric count — nothing else distinguishes them visually except a subtle increase in a muted-red tint as severity rises (present but not labeled). Tapping a box increments today's count for that tier (`logReflectionEntry(tier)` Server Action, plain insert); a small `−` affordance on long-press/secondary-tap decrements (misclick correction — deletes the most recent entry of that tier for today). Below the three boxes, a thin 7-day sparkline per tier (total count per day, last 7 days) so trend is visible without needing a legend — Ayman recognizes his own pattern; a passerby sees three abstract counters and a chart, nothing legible as a moral category.

### New: Habit builder
Section title: **"Habit Builder"**. Layout:
- **This week's focus** card at top: the currently-focused habit's name + its daily toggle + current streak. Edit affordance to change/rotate the focus (opens a picker: pick an existing Active-Build habit, or type a new habit name which creates it in `deen_habits` with `committed_date = today` and simultaneously sets it as this week's focus). On a new week boundary (Sunday, matching `getWeekStartDate`), if no focus has been set yet for the new week, the UI prompts the user to pick one (carries forward the previous week's focus habit as the pre-filled default, not auto-silently — Ayman explicitly re-confirms or changes it, since "rotate every week" implies an active choice each week, not silent continuation).
- **Active Build / Stabilized / Locked**: three stacked lists (or 3-column on desktop where width allows — see Part 4's responsive rules, Deen page itself can also loosen its `max-w-2xl` here since a 3-column habit board benefits from width same as Home does), each showing habits currently in that computed stage: name, streak, today's daily toggle. Locked habits are visually deprioritized (quieter styling, still toggleable — the point is consistency tracking, they don't stop mattering just because they're locked in).

---

## Part 4 — Home screen v2

### Layout shape
Replace the current `max-w-2xl` centered-strip layout with a responsive grid:
- **Desktop (`lg:` and up):** 3-column grid — left rail (fixed-ish width, e.g. `lg:grid-cols-[280px_minmax(0,1fr)_280px]`), center column, right rail. Page container goes to a much wider `max-w` (e.g. `max-w-[1600px]`) so it actually uses monitor width, but the *center* column itself still caps prose/list width for readability — width goes to the rails and gaps, not to stretching the priority list into unreadably long rows.
- **Tablet (`md:` up, below `lg:`):** 2-column — center column + a single combined rail (all 5 domain peek cards stacked vertically in one column). No 3-column squeeze at this width.
- **Mobile (below `md:`):** single column. Order: Right Now strip (hero + priority list, unchanged position/priority from today) → horizontally scrollable snap-carousel of the 5 domain peek cards → weekly summary chip row (scrollable if it overflows).

This is standard Tailwind responsive grid — no JS resize-detection needed, so it "just works" continuously as a window is dragged between monitor and laptop, not only at specific breakpoints snapping.

### Content
- **Right Now strip (center, top):** existing `NextUpHero` + `PriorityList`, visually restyled to feel denser/richer (icon + domain accent bar + urgency chip per item — reuse `urgencyBucket`, already client-ticking) but logic unchanged. This is still the single highest-leverage thing Ayman should see first.
- **Domain peek cards** (one per domain, each a `Link` to that domain's page, domain-accent-colored): built from a new aggregator `lib/home/get-domain-snapshots.ts` (Server Component data, parallel-fetched like `getDomainPulse`) returning one snapshot object per domain:
  - **Deen:** next prayer name + countdown, 5-dot today's-prayers status strip (fajr..isha, filled per status), Qur'an weekly pages vs. target progress bar, this week's habit-builder focus name + streak.
  - **Business:** if a Lock-In session is active — elapsed time + live S:N badge; else — kill-list completion (`n/3` today) + this week's S:N ratio badge (reuses `getWeeklySignalNoiseRatio`, already computed).
  - **Fitness:** today's scheduled workout name + done/not-done, weekly consistency % (reuses `calculateWeeklyConsistency`).
  - **School:** tasks due today (count) + the single next-due item's title.
  - **Co-op:** same shape as School (reuses the same underlying `tasks`/`schedule_events` queries, just `domain = 'co_op'`).
  - Each card keeps a small radial ring using the existing `getDomainPulse` fraction as a corner accent (reuses tested code, doesn't replace it) alongside the new richer text content.
- **This Week summary strip** (bottom of center column on desktop, after the carousel on mobile): S:N ratio, Qur'an pages this week, workouts completed this week, tasks completed this week — four small stat chips, no new data fetching beyond what the peek cards already pulled (just surfaced again as a compact row).
- Weekly-planning Saturday-evening nudge: unchanged, same trigger logic, just restyled to fit the new grid (still a single banner, now spanning the center column).

---

## Phased build order (layers, each fully tested before the next starts)

1. **Phase 1 — Schema.** All migrations above (`reflection_entries`, `deen_habits`, `deen_habit_logs`, `deen_weekly_focus`, `work_sessions`, `checkins.work_session_id`). Verify via `get_advisors` (security) clean, RLS confirmed on every new table.
2. **Phase 2 — Business Lock In.** Backend actions + `LockInSession` + wiring into Business page + removing the global scheduler from `AppShell`. Fully testable in isolation (doesn't depend on Deen or Home changes). Unit tests (slot computation, actions) + live Playwright click-through (lock in, wait past an hour boundary using a short test interval override or mocked time, answer a prompt, confirm live S:N updates, end session, confirm weekly S:N still correct).
3. **Phase 3 — Deen changes.** Remove Adhkar/Traveling sections, add Reflection tracker, add Habit Builder. Independent of Phase 2. Unit tests (stage derivation, streak calc, reflection tally) + live Playwright (tap all 3 reflection tiers, set a weekly focus, log a habit, confirm stage placement).
4. **Phase 4 — Home v2.** Depends on Phases 2–3 existing (peek cards read real Business/Deen shapes). Build `get-domain-snapshots.ts`, restyle the grid, wire all 5 peek cards + summary strip. Unit tests on the aggregator + live Playwright at 3 viewport widths (desktop ~1600px, laptop ~1440px, mobile ~390px) confirming no horizontal scroll/overflow and correct column collapse.
5. **Phase 5 — Full regression.** Full unit suite, `tsc`, lint, full Playwright E2E suite, deploy to Vercel, live production verification (same discipline as prior sessions — re-run against the actual deployed URL, not just local).

Each phase: engineer implements + commits with tests green, then messages the lead; lead independently reviews the diff, re-runs tests, and does its own Playwright pass before authorizing the next phase to start. No phase starts implementation before the previous one is lead-verified.
