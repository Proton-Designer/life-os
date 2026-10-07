---
id: mem.decisions
title: Decisions
layer: L2
type: memory
status: canonical
owner: unassigned
updated: 2026-10-04
answers:
  - "why was X chosen"
  - "why do we do it this way"
  - "was Y considered"
covers: "Decisions made, alternatives considered, what superseded what"
excludes: "Work currently in progress (see mem.active-work), currently-broken behavior (see mem.known-issues)"
tokens_est: 1455
---

# Decisions

Newest first. Full reasoning lives in the dated source doc under
`docs/superpowers/` — these entries are pointers with the load-bearing
conclusion, not a replacement for reading the original when it matters.

---

## 2026-10-04 — IA Option A "Rhythms": the day and the week are rituals on Home, not screens

**Status:** Active — user-approved ("do option A"); plan `audit/IA/IA-A-PLAN.md` (run 20261004-1135)
**Decision:** Today, Review, Worries, Goals, Habits and Weekly Review stop being nav screens. Home carries the day (Morning card → Today strip → Close the day → Done), `/week` is the Sunday reset, Insights has a Week tab; every retired URL redirects (nothing deleted, bookmarks and pushes keep working; `/review → /close` stays load-bearing). Defaults taken: Calendar stays a screen, week = Sunday, the evening gate stays, habit check-offs live in Home Now.
**Shipped:** P1 `40ac3a6` `fe71a95` · P2 `75313d4` · P3 `775c5a4` `69fff23` · P4 `7332dfa` `5081712` `ce89ffb`. **Not done:** Launch-step reorder (no position column), MCP twins for the new actions (parity `pending`), per-tab Work data (T-0002).

## 2026-10-04 — The evening close's day rolls over at 4 AM (`effectiveDayString`)

**Status:** Active — Lead ruling during IA-P2 (`75313d4`)
**Why:** `/close` used `localDateString(now)` everywhere, so a close at 00:30 on Oct 5 recorded `evening_closes` for Oct 5, planned "tonight" for Oct 6 and left Oct 4 unclosed — a night owl planned the wrong day (and Home's Done card would have shown all of Oct 5 as done). **How:** one rule in `lib/date-utils.ts` (`effectiveDayString`, wall-clock hour compare — `resolveLocalTime` is an hour off on the DST-transition morning) used by the close's write date, `planningDateForCore('tonight')`, the close page's data, `reviewDateFor` and `homeRhythmState`. Replan and Start Day keep plain local today. MCP `night_plan_task` writes inherit it (same core).

## 2026-10-04 — Work tabs: stable `key`, editable `label`, kind picks the screen; data NOT scoped yet

**Status:** Active — WORK-W1/W1b (`51932ef`, `58b45a3`)
A Business tab is a `user_subdomains` row with kind `business` under the Work domain (not a separate area): `/business` redirects to it, Sector progress shows one row per tab with its label (SECTOR-01 `f5508be`), the SYSTEM nav drops the duplicate link. `ensureBusinessWorkTab` is explicit and idempotent (never from a render) and, for an account with no active tab, also creates a job tab so the existing Work content stays reachable. Per-tab data (T-0002/W4) is deferred — extra tabs of one kind share data and the UI says so.

## 2026-10-04 — Launch sequence + Wind-down replace the Morning-routine checklist and nightly sleep intent

**Status:** Active — IA-P4a/b (`7332dfa` migration 253, `5081712`, `ce89ffb`); both stay opt-in, OFF by default
Launch sequence = ≤5 if-then steps (`morning_routine_items.if_cue / fallback_text / habit_id`), "x of last 7" is a count (never a streak), one tap = tick + the linked habit's vote via `setLaunchStepDone` (rolled back together). Wind-down = a **set-once** plan (`user_settings.wake_time / sleep_need_minutes / wind_down_minutes`); bedtime and wind-down start are derived, never stored, and drive Home's Close-the-day card, the topbar moon link and the reminder push. The reminder is the **Vercel cron route only** (`/api/cron/sleep-reminder`, per-user window, 2h, never past midnight, fallback 21:30) — no edge-function change; registering the pg_cron poll is operator state. `sleep_intents` rows are kept, no longer shown.

---

## 2026-09-15 — MCP `school.task.edit` is MERGE semantics; the UI's own edit form stays full-replace

**Status:** Active — Opus Lead ruling, P4-08 (overnight run-20260915-0011)
**Source:** `.claude/overnight/run-20260915-0011/board/03-in-review/P4-08-write-coverage-school-qbank-ulm.md`

**Decision:** Calling `write(domain:"school", entity:"task", action:"edit", id, patch)` through MCP now merges — a field the caller omits from `patch` keeps the task's current value, rather than being cleared. `due_date` and `task_type_other_label` accept an explicit `null` in the patch to clear them (the one thing MERGE semantics would otherwise remove versus the old behavior, where simply omitting a field cleared it). The app's own task-edit form, and `lib/tasks/actions-core.ts#updateTaskCore` itself, are UNCHANGED — still full-replace. The merge happens entirely inside the write-registry.ts handler: it reads the existing row, resolves each field (`patch.field === undefined ? existing.value : <validated from patch>`), then calls the same, untouched `updateTaskCore` with the fully-resolved values.

**Why:** An AI agent calling this tool typically wants to change ONE field ("push this task's due date back a day") without first reading back and re-sending every other field — full-replace makes that a lossy trap (omit `class_id` by accident, and the edit silently unlinks the task from its class). The UI's own edit dialog already always has the full row in hand (it's editing a form pre-filled from that row), so full-replace costs it nothing and stays as-is — only the MCP write path's shape needed to change.

---

## 2026-08-19 — A missed Lock-In hour resolves to `wasted`, and every hour stays editable

**Status:** Active — ruled by Ayman 2026-08-19 16:45 CDT
**Source:** `docs/superpowers/specs/2026-08-19-missed-lockin-hours.md`

**Decision:** An unanswered check-in hour, once superseded by a newer slot,
derives to `wasted` automatically (no cron — same derive-don't-write pattern as
`lib/deen/prayer-status.ts`). Every hour, during or after the session, stays
editable between signal and wasted.

**Why:** This reverses an earlier same-day ruling that treated silence as
"unknown, not noise." That was defensible on consistency grounds, but it
created a loophole: ignoring every hourly prompt scored as full signal with no
visible trace. Ayman: *"a missed check in during lock in session should be
counted as noise, but the user can go back and update/change status."*

**Consequences:** `subtractConfirmedHours` was renamed
`subtractResolvedHours` and widened to cover answered ∪ missed hours, to avoid
double-counting coarse Lock-In overlap credit against an hour already resolved
to a precise value.

**Do not undo without understanding:** auto-marking without editability would
punish being deep in work or away from a phone; editability without
auto-marking reopens the silence loophole. Ship both together or neither.

---

## 2026-08-18 — Business section: subtraction, not hours, is the lever; ship framing before redesign

**Status:** Active — synthesis for Ayman's decision, from two research tracks
**Source:** `docs/superpowers/specs/2026-08-18-business-brainstorm-synthesis.md`

**Context:** `kill_list_items` and `weekly_goals` had zero rows each, despite
both existing in the schema. Research covered productivity-book claims (Musk,
Hormozi, Jobs, O'Leary) that partly conflict on whether more hours or more
subtraction produces output.

**Decision (R1–R5, ranked):**
- **R1** — frame both empty modules: say what the thing is, why three slots,
  give one example. Copy, not architecture; addresses the actual problem the
  zero-row evidence points at.
- **R2** — keep all three Kill List slots visible permanently, slot 1 open and
  required with slots 2–3 behind "+ add another" — every day, not just a
  first-run special case (a first-run-only version of this was considered and
  rejected: one item has no trade-off, so it teaches a different, easier
  exercise than the three-item constraint is meant to build).
- **R3** — yesterday's unfinished Kill List items resurface instead of
  vanishing at midnight (reuses the existing Qada backlog pattern; needs no
  schema change).
- **R4** — surface today's running Signal:Noise ratio live inside the Lock-In
  panel, not only after the fact.
- (R5 not separately titled in the source; treat the doc as authoritative if a
  fifth ranked item is needed.)

**Why "hours as the lever" was rejected:** every one of the four operators'
own *practiced* (not merely stated) behavior is subtraction-shaped — O'Leary's
three Post-its, Jobs's say-no filter, Hormozi's sleep floor, even Musk's own
Algorithm opening with "delete." The pro-hours claims in the research were the
least-verified and most-viral ones.

**Product consequence:** the app must never present accumulated hours as an
achievement. Focus time stays as context for output, never as a score.

**Explicitly not built on:** several popular claims were checked and found to
be folklore rather than the attributed source's own claim — Musk's "5-minute
blocking" (he publicly refuted it in 2018), Hormozi's "backward calendar
scheduling" (traces to one TikTok, not him), the maker/manager schedule (Paul
Graham, not Hormozi), "21 days to a habit" (a 1960 anecdote; real range is
18–254 days), the 70%/35% accountability statistic (never replicated).

---

## 2026-09-09 (approx.) — MCP connector session JWTs are signed with the legacy HS256 secret, not a new ES256 key

**Status:** Active
**Source:** `docs/ai-connector/OPERATOR-ACTIONS-PENDING.md`

**Context:** the original plan was to import a new ES256 public key into
Supabase for verifying MCP session JWTs.

**Decision:** that path was abandoned — the Supabase dashboard only offers
"Create Standby Key," never import, so it was never possible. Instead,
`lib/mcp/session.ts` signs with the project's legacy HS256 shared secret
(`SUPABASE_LEGACY_JWT_SECRET`), verified to work with PostgREST and RLS before
anything was built on it.

**Do not undo without understanding:** Supabase labels that key
"revoke once all tokens have expired." Revoking it breaks the MCP connector
with no fallback — see `.brain/memory/known-issues.md`.

---

## 2026-10-04 — Deen Mode is one boolean on `profiles`, default OFF, gate-only

**Status:** Active
**Source:** `.claude/overnight/run-20261004-1135/INSTRUCTIONS.md` (D1–D7), migration 251

**Decision:** religious surfaces are controlled by `profiles.deen_mode` (not an `enabled_features` entry, not a `user_domains` row). New accounts are OFF; OFF hides, never deletes (R4); onboarding offers no faith option. In Settings it supersedes the `hidden_features` "deen" entry, and `deen_mode` is intentionally not MCP-writable.

**Do not undo without understanding:** `enabled_features` has a DB CHECK tied to a TS enum, and a user wanted the switch in the Features panel; making it a domain row would let onboarding re-introduce faith.

## 2026-10-04 — Deen Mode: decisions behind the build (run 20261004-1135)

**Status:** Active
**Source:** `.claude/overnight/run-20261004-1135/INSTRUCTIONS.md` §2 (D1–D7, A1–A3), `LOG.md`

- **Single column, not `enabled_features`:** see the entry above.
- **OFF = gate, never delete (R4):** every OFF path skips the query or refuses the write; no row is changed. Gates are *required* parameters so a forgotten caller fails `tsc`, and Server Actions refuse server-side (they are public endpoints).
- **AI connector blocked when OFF (A2):** the `deen` domain is hidden and deen reads/writes refused (`ToolInputError`), including deen-flavoured rows inside non-deen entities (triggers, allocations, events, action plans/outcomes, widgets, schedules). `deen_mode` is never AI-writable.
- **Goals tagged `deen` are hidden when OFF** (they are religious content); data kept.
- **Optimistic tap pattern (PERF-1/2/3):** per-item local state via `lib/client/use-optimistic-item` (+ `use-optimistic-toggles` for lists) on `lib/client/keyed-queue` (writes for one key run in tap order; keys independent; nothing disabled while another saves; per-item rollback), writes are **absolute setters, never toggles**, hot-tap actions are lean (no inline `revalidatePath`), and ONE debounced data-free refresh Server Action (`refreshXViews`) re-syncs surfaces per burst. Why a Server Action and not `router.refresh()`: only `revalidatePath` purges the client Router Cache for other routes (Home).
- **Test plan (heat):** vitest runs `.ts` in node and `.tsx` in jsdom (e4e4be8; a `.ts` test needing DOM starts with `// @vitest-environment jsdom`). Per task: related tests while building, ONE `heavy.sh ./scripts/preflight.sh` before the author's commit, reviewers run `related` + tsc only, the lead runs a full preflight per deploy.

**Do not undo without understanding:** converting an absolute setter back to a toggle reintroduces the failure-then-queued-tap flip bug (PERF-1 review F1).

## One "+" capture: Task picks its area, Note → Inbox, one distraction logger (IA-P1a, 2026-10-04)

**Status:** Active (IA Option A, phase P1a)
**Source:** `audit/IA/IA-A-PLAN.md`, `lib/capture/areas.ts`, `lib/inbox/inbox-core.ts`

- **Task area is chosen, never hard-wired:** `captureTask({area})` — `school`/`co_op` → `addTaskCore` (`tasks.domain` CHECK admits only those); `none` = the **Inbox**. An unknown/missing area throws (no quiet default to School). The sheet's chip row comes from `buildCaptureAreaConfig(navMode, navDomainState)` (legacy = School + Work + Inbox; domains = only the areas turned on; a Work area needs a job tab). Default per route: `/school`→School, `/work`, `/work/<job tab>`→Work, `/work/<business tab>` and `/business`→No area (Business has no task home — never guessed), elsewhere→No area.
- **Inbox = existing rows, no migration:** `tasks` with `domain IS NULL`, `dump_source='capture'`, `completed=false` (a Note, or a "No area" Task which also keeps its parsed due date/time). The evening close PLAN stage shows them above the dump with one-tap triage (`triageInboxItem` → `triageInboxCore`): Plan tonight (→ `dump_source='note'` + the ceremony's planned date, server-derived), Task in <area> (→ domain set, planned_date cleared), It's a worry (→ `dump_source='worry'`), Done (→ `completed=true`; nothing is ever deleted). Every update re-asserts the Inbox shape in its WHERE and errors when 0 rows change, so a stale tap can't touch an already-triaged row. Only `/close` (tonight) shows the Inbox, not `/close/replan`.
- **One distraction logger:** the "+" sheet's Distraction segment opens the topbar `DistractionCaptureDialog` (controlled `open`/`onOpenChange`/`hideTrigger`) instead of its own text form. The standalone `/capture` page (no app shell/Lock-In provider) keeps the old text form via `captureDistraction`, which ends in the same `createTriggerAndLog`.

**Do not undo without understanding:** moving a triaged Inbox row without leaving the `domain null + dump_source capture` shape makes it reappear in the Inbox every night.

## Weekly reset (/week) replaces Weekly Review, Goals, Habits and Worries screens (IA-P3a, 2026-10-04)

**Status:** Active (IA Option A, phase P3a; nav removals + Home Sunday card are P3b)
**Source:** `audit/IA/IA-A-PLAN.md`, `audit/IA/P3-design-eng1.md`, `lib/week/reset-window.ts`

- **/week** = one page, five anchored steps: look back (the weekly-review body) → goals & milestones → habits keep/pause/drop → worry hour → this week's goal (the shared `WeeklyGoalsHeader`/`saveWeeklyGoal`). Each step is the pre-existing reader/component moved into a server component (`WeeklyReviewBody`, `GoalsSection`, `HabitsSection`, `WorriesSection`); nothing new is written by the page itself. The reset reviews the most recent COMPLETED Sun–Sat week (today excluded; Sunday is day 1 of the new week) and step 5 sets the goal for the week containing today.
- **Old routes redirect, nothing deleted:** `/goals|/habits|/worries` → `/week#<step>`; `/weekly-review` → `/week` inside the reset window (local Sunday 00:00 → Monday 12:00, `isWeeklyResetWindow`, edges via `resolveLocalTime`) else `/insights?tab=week`. Insights `?tab=week` is the "Weekly review" tab, with a "Start weekly reset" button that works any day. Widget layout keys (`goals`, `habits`, `weekly_review`) are unchanged, so saved layouts keep rendering.
- **Revalidation:** goals/habits/worries actions now also revalidate `/week` (the old paths stay: they are redirects, not data).

## Launch sequence + Wind-down plan (IA-P4a, 2026-10-04)

**Status:** Active (P4a = data/actions/reminder/Insights/Settings; the Home cards are P4b)
**Source:** `audit/IA/P4-design-eng1.md`, migration 253, `lib/rhythm/*`

- **Routine steps are `morning_routine_items`** (no new check table): migration 253 adds `if_cue`, `fallback_text`, `habit_id` (composite FK, `ON DELETE SET NULL (habit_id)` — column-scoped on purpose). New steps stop at **5** (`MAX_ROUTINE_ITEMS`); longer existing lists still render. Ticks stay in `morning_routine_checks` keyed by local date. `setLaunchStepDoneCore` is the one absolute setter (tick + the linked habit's vote, rolled back together if the vote is refused); MCP `routine_item.check/uncheck` use it too, so agents get the same semantics. "x of the last 7" = distinct days in the window (never a streak).
- **Wind-down is set once, derived always:** `user_settings.wake_time` + `sleep_need_minutes` + `wind_down_minutes` (default 45); `deriveWindDown` gives bedtime = wake − need and wind-down start = bedtime − wind_down. Only evening starts (≥ 15:00) are used (`eveningWindDownStart`); otherwise Home keeps 21:00 and the reminder 21:30. `sleep_intents` is untouched (data kept, no longer asked).
- **Reminder:** `dispatchSleepReminders` opens each user's window at their own wind-down start (2 h, never past local midnight). The reminder lives only in the Vercel cron route — there is NO sleep reminder in the dispatch-notifications edge function, so no edge redeploy is needed for it.
- **Insights Rhythm card** (Week tab, Sleep plan opt-in): wake spread from `day_starts`, close-vs-bedtime from `evening_closes`; counts/spreads only, and an honest "needs 3 …" under 3 points.
- **Still to do (P4b):** Home Launch-sequence / Wind-down / "Lights out by" cards (fixes the card's resync + midnight bugs), `windDownStart` into `homeRhythmState`, and the topbar moon link following the same wind-down start.

## 2026-10-04 — NAV-01a: Router Cache back to 30 min, freshness from focus-refresh + realtime
`experimental.staleTimes.dynamic` was 60 s (a stand-in for cross-device freshness), so every revisit after a minute refetched the page (1-2 s on a real account). Now 1800 s. Cross-device freshness: RealtimeSyncProvider (mounted) plus `components/shell/focus-refresh.tsx` (router.refresh() when the tab/PWA returns after >= 60 s away, throttled 30 s; refresh also drops every cached page). Polling Server Actions (getNotificationsForNow, getAllocationQueueForNow, get{Today,Session}DistractionCount*, getWeekCalendar) must never call revalidatePath/refresh: pinned by `lib/client/__tests__/polling-actions-no-revalidate.test.ts`. No cross-request server data cache was added (it would need per-user keys + tag invalidation on every write).

## 2026-10-04 — NAV-02: shell polling is GET route handlers, not Server Actions
Next dispatches Server Actions from one client strictly one at a time (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md` "Sequential dispatch on the client"; `client/components/app-router-instance.js` `dispatchAction` appends to `actionQueue.last`), so a poll that is an action makes the user's next tap-write wait behind it (optimistic UI says done, a quick reload loses the write). The topbar/bell/check-in-queue/capture-dialog polls and the calendar dialog's read now `fetch()` `app/api/shell/*` (cookie session via `getAuthedUser`, same readers/RLS, `Cache-Control: private, no-store`, 401 when signed out, generic 500) through `lib/client/shell-fetch.ts`. The four poll actions (getNotificationsForNow, getAllocationQueueForNow, getTodayDistractionCountForNow, getSessionDistractionCountForNow) were deleted along with their parity-manifest lines; `getWeekCalendar` stays an action only for `/calendar`'s own page render. Pinned by `lib/client/__tests__/polling-actions-no-revalidate.test.ts` (includes a canary that the installed Next still documents one-at-a-time dispatch). Rule: a new background read goes in `app/api/shell/`, never a Server Action.

## 2026-10-04 — HOME-01a: adjustable focus target + persisted morning-brief minimize
`user_settings.daily_focus_target_minutes` / `weekend_focus_target_minutes` (smallint null, CHECK 30-720; migration 256). One reader, `focusTargetMinutes(settings, localDate)` in `lib/focus/target.ts` (weekend = Sat/Sun of the user's LOCAL date; NULL daily = 240; NULL weekend = daily; out-of-range stored values are ignored). `DAILY_HOUR_TARGET` is gone: `hoursOfDailyTarget(minutes, targetMinutes = 240)` now takes minutes ("2 of 4.5"). Server loader: `loadFocusTargetMinutes(supabase, userId, localDate)` (`lib/focus/target-core.ts`). `morning_brief_collapsed_on` stores the brief_date the user minimized, so the brief is collapsed only while today's brief_date equals it and a newer brief shows expanded again without a cleanup job (`lib/morning-brief/collapsed-core.ts`). Both writes are absolute setters (ensure row, update, prove a row changed); the minimize action DOES `revalidatePath("/")` after a successful write (corrected same day): Home's Router Cache lives 30 min and a cached payload would re-seed the provider with the old `initialCollapsed`, resurrecting a minimized brief.

## 2026-10-04 — SCHOOL-01: assessments have ONE write path; Exam absorbs Final/Midterm
`class_assessments` is the source of truth and each created assessment has a paired `tasks` row (`class_assessments.task_id`); Calendar / Home Now / Due today / the day bar read the TASK, the risk panel / grades / the Assessments module read the assessment. Creation entry points (class dialog, syllabus/announcement/Canvas staging confirm, MCP) all go through `addClassAssessmentCore`; edits through `updateClassAssessmentCore`; removal is the atomic `delete_class_assessment` RPC (hard delete of assessment + task). Both directions stay in sync: assessment→task in the school cores, task→assessment in `updateTaskCore`/`removeTaskCore` (editing or removing the paired task in the School task list updates/removes its assessment). Every write revalidates `ASSESSMENT_VIEW_PATHS` (/school, /, /calendar, /close) because of the 30-min Router Cache. Migration 257 turned `final_midterm` into `exam` but left both type CHECKs permissive; the cores normalise (`normalizeAssessmentType`/`normalizeTaskType`) and pickers use `TASK_TYPE_OPTIONS`/`PICKABLE_ASSESSMENT_TYPES` (no Final/Midterm). The module reader is `getAssessmentsOverview(supabase, userId, today)` (Soon 0-7 / Upcoming 8-30 / Future 31+ days; "No date" = staged syllabus items still missing a date, since `class_assessments.date` is NOT NULL).

## 2026-10-04 — QURAN-01: the khatm plan (server side)
One bookmark (`quran_plans.current_page` = the NEXT page to read, 605 = finished); everything else is derived in `lib/quran/plan.ts` (pure, local-date strings only): cumulative target at the end of a day = round(pace x active days elapsed), so the finish day lands exactly on page 604; today's portion = bookmark -> that target, at least one page while unfinished (catch-up is built in); paused days are frozen and push the finish date out. The plan is re-based (plan_set_on/plan_set_page) by Keep/Move date; `original_pace_pages_per_day` is immutable and drives the 2x "move the date" nudge. One open plan per user (partial unique index). Logging moves the bookmark with a guarded UPDATE on the page it was read at (no double counting across devices/taps), then writes a `quran_sessions` row (pages_read/surah/juz stay filled, so every legacy Quran reader and the weekly page count keep working) with from_page/to_page/plan_id. Everything is Deen-gated server-side (`app/(app)/deen/quran-plan-actions.ts`, MCP twin `deen.quran_plan.log_reading`). Page map (`lib/quran/page-map.ts`) is generated from Tanzil's Madani metadata and verified by `verifyPageMap` (juz starts match the approved design). Surfaces read one `getQuranOverviewCore` through the adapters in `lib/quran/surfaces.ts`.

## 2026-10-05 — HABIT-FREQ: one cadence model for both habit systems; logs untouched
Both `deen_habits` and `identity_habits` got the same four columns (migration 259) instead of a shared table or a recurrence-rule blob, because the two systems share no code and a generic RRULE would have bought nothing the five real cadences (daily / certain weekdays / N per week / N per month / every N days) don't. A completion stays ONE row per (habit, date), so no log schema, writer or reader changed; a flexible habit's progress is a count of rows in the period. Chose Sun-Sat weeks and calendar months (matches `getWeekStartDate`), and a softened target for the first partial period (a habit made on a Saturday cannot owe 3 that week). Identity score decay is `0.96^(days x expectedRatePerDay)`: per-vote weight unchanged, so a steady weekly voter still converges to 1.0 instead of reading as failing six days out of seven. Alternatives rejected: storing a streak/score (the repo's rule is derive, never store); a per-habit "grace" setting (YAGNI).

## 2026-10-05 — Prayer streak is on-time only, from full history
Qada no longer qualifies a day (user ruling): the streak answers "did I pray on time", Qada is repayment. Computed from every on-time day (lean paged read) instead of the page's 60-day window, which would have capped it and cannot know a longest-ever streak.

## 2026-10-05 — Morning/night thread: what was built, and what was deliberately NOT
Built: (1) the morning brief now names last night's crown + starred tasks (`tasks.planned_date`/`mit_rank`), and says nothing when no plan was made; (2) "Woke earlier?" on the Morning card starts the day from a chosen wake time (`startDayAtAction`, `markDayStarted(..., wokeAt)`), FIRST MARK ONLY; (3) ticking a Launch step while the day is unstarted OFFERS Start day (never auto-starts); (4) Re-plan stays on the Today strip; (5) the sleep reminder and Home's Close-the-day card share ONE default (`DEFAULT_WIND_DOWN`, 21:00); (6) one-time "Set up your day" (`lib/day-setup`) on the Done card while neither opt-in is on: plan + up to 3 steps, features enabled LAST and additively; (7) weekly review: `wakeVsPlan` + a one-tap "move my wake time to X" when the median start is >= 30 min late.
Deliberately NOT: **editing a wake mark after it exists** (migration 153 has no update policy so Delta/Efficiency can't be re-written; backdating is only possible before the mark exists), **a "you didn't start today" prompt at close** (close-reflect-stage's header records the ruling that the close never nags about a skipped morning ritual), **auto-starting the day from a Launch tick** (a late catch-up tick would record a wrong wake time that can't be fixed), **a sleep-intent UI** (the derived wind-down plan replaced it; `sleep_intents` + its MCP actions are still orphaned, harmless). The "Set up your day" snooze is per-browser localStorage on purpose (no column for a convenience).

## 2026-10-05 — Time is 12-hour everywhere; stored values stay 24-hour
`formatHHMM12` / `formatClock12` / `formatHourMinute12` (lib/date-utils.ts) are the only way a time becomes text; `components/ui/time-field-12.tsx` is the only time picker (a pill + popover wheel since 2026-10-07; see below). Native `<input type="time">` and `toLocaleTimeString()` follow the browser locale (a 24-hour locale shows "21:00" whatever the page says), so `lib/__tests__/no-24-hour-time-ui.test.ts` bans them in app/ and components/. Columns, MCP inputs and `HH:MM` internals are unchanged. MCP/AI-facing error text keeps "HH:MM (24-hour)" because the tool contract requires it.


## 2026-10-05 — One top three: the night plan is the source of truth; the Kill List is Business's view of it
- Business has no task home (`tasks.domain` is school/co_op), so there is no "Business task" to star. A starred plan line can be marked **Business** in the plan stage (only when the account has a Business Kill List: legacy, or a Business Work tab); on Finish `savePlanRanks(..., killListIds)` mirrors it into that day's `kill_list_items` (`lib/night-plan/kill-list-mirror.ts`: first free slots, idempotent by text, overflow reported not dropped).
- Deliberately NOT done: unmarking/unstarring later does not delete the Kill List row (nothing links the two and a row may have been edited/completed). A link column + completion sync would be the next step if this proves wanted.
- The Launch card rehearses ONE distraction plan (`lib/distractions/rehearsal.ts`): yesterday's hardest planned trigger, else the most frequent; plans needing a rewrite are never shown. It reuses `getAllTriggers` with YESTERDAY as the "today" date, so `todayCount` is yesterday's count.

## 2026-10-05 — "My agent's write-scoped token couldn't write": the server was never asked
- The Spectre token was `{read,write}` and the audit log (`mcp_audit_log`) showed 54 REST calls, ALL discovery/reads, zero write attempts and zero scope denials; a live production write with a fresh write token (deen.habit.create) returned 200. So nothing server-side refused a write: the agent's only HTTP tool could send GET (with headers), not POST.
- Fix: `GET /api/v1/write/{domain}/{entity}/{action}?id=&patch=<url-encoded JSON>` = the exact same `write` tool as the POST (same scope check, validation, audit, no-store). Still header-token only (a token in the URL is refused before routing); a Bearer header can't be attached by a cross-site request, so a state-changing GET is not CSRF-able. Documented in agent.md + the discovery route list.
- Also added the missing read half `deen.weekly_goal` (it was write-only, so an agent could not read the goal it was about to overwrite).
- Lesson: when "the agent can't write", check `mcp_audit_log` first: no write rows at all means the request never reached us.

## 2026-10-05 — Kill List is 2 + an optional third; Work and Business can each offer the other's modules
- Kill List: slots 0 and 1 are the day's commitment, slot 2 is a dimmed "Optional" placeholder until opened. The module's target is 2, or 3 once the third has text (`lib/business/kill-list-target.ts`, plain module because a Server Component can't call a function exported from a "use client" file). No schema change: the table still has 3 positions; Home's "x/y" already counted existing rows.
- Cross-domain widgets: `registry.ts` gives Work the Business widgets and Business the Work widgets, flagged `defaultHidden` + `fromDomain`, so they are offered in the widget manager (tagged "From Work/Business") but OFF until added. A layout is keyed by the HOST page's domain (`business` / `work`), so adding Work's pipeline to Business never touches Work's own layout, and vice versa. Work now registers its schedule strip and Targets & goals as widgets too (`work_schedule`, `targets`) alongside `pipeline`.
- To render a module on both pages without duplicating it: `loadBusinessModulesData` + `BusinessModules` and `loadWorkModulesData` + `WorkModules` (data + presentation split; each page only loads the OTHER domain's data when one of its modules is switched on). A job tab and a business tab still share one dataset per kind (T-0002/W4); this does not change that.

## 2026-10-06 — Plan details (domain / start time / timer) and Edit Plan
- **`plan_area`, not `tasks.domain`.** `tasks.domain` (school/co_op) is the task-LIST home and gates which page lists a row; "what area of life is this" is a different question and may name a domain with no task list (Fitness, Faith). New column, loose shape CHECK (user_domains keys were re-cut once, migration 115). Gives insight-by-domain without widening the closed `Domain` type Home's arbiter relies on.
- **Home shows a plan line once.** The plan list owns any task with `plan_area` and any Kill List row paired to a plan line (`tasks.kill_list_item_id`, composite FK with `ON DELETE SET NULL (kill_list_item_id)` per the 129 incident); both sides' completion is synced. Unchecking "Add to Kill List" later removes the open row the plan created; a completed row is kept as the record.
- **School always offers Start (Deep Study); Business/other only when timed.** From the owner's spec: a Business line with no time is a Kill List line (finishing is the action); a School task's only action is studying. Start/Complete is decided by ONE pure function used by both the button and the server action.
- **Timed lines run in clock order; manual order breaks ties and orders the rest.** The up/down order is real but never overrides a start time.
- **Work Backlog = the active position-1 target's `coop_tasks`**, fired once on entering Work (not on every re-save). No active target -> the line stays on the plan with a notice, never an invented target.
- **Edit Plan is the nightly stage in `today` mode, not a second editor** — one component, one `commitPlan` write.

## 2026-10-07 — Edit Plan always has a Save; lines expand independently
- **Root cause of "there's no save button":** the stage rendered Save/Finish only when a line was crowned, so Edit Plan with no crown could never write domains, times or timers. Now `mode="today"` always renders "Save plan" (with a muted "Unsaved changes" while the draft differs from what was last written). The nightly `tonight` ceremony is unchanged: Finish still needs a crown, and a line under the hint says domains/times/timers are saved at Finish.
- **Saving an empty rank set must clear old ranks.** `savePlanRanksCore` used to return early when nothing was starred, which would have left yesterday's stars on the plan after "unstar everything, Save". `commitPlan` now passes `clearWhenEmpty` so it clears `mit_rank` for the day first (the MCP `save_ranks` keeps its no-op); the tonight path never reaches it empty (crown required).
- Open state is a `Set<string>` (several lines open at once), a chevron on each title row plus "Expand all / Collapse all" above the list; new lines start collapsed.

## 2026-10-07 — One time picker everywhere: pill + iOS-style wheel (Package B)
`TimeField12` keeps its name, props and "HH:MM" storage contract, but is now a pill ("9:00 PM" / "Set time") that opens the wheel (`components/ui/wheel-time-picker.tsx`, moved from `components/plan/`) in a popover with Clear / Done; all 8 callers switched with no call-site change. New optional prop `defaultOpenValue` is where the wheel lands on an empty value (opening emits it). Why: the three-select row was disliked; the wheel was too big and could not be dragged with a mouse. Non-obvious bits: (1) mouse drag only (touch / trackpad keep native scroll), pointer capture is taken only after 4px of movement so a plain click still reaches the row; (2) inside a modal Radix Dialog the popover is portaled INTO the dialog element (`PopoverContent container`), because the dialog's scroll lock swallows wheel/touch scrolling in anything portaled to body; (3) "I woke up at" opens on the user's local time rounded DOWN to 5 minutes (`floorHHMMToStep(localClockHHMM(now, timezone))`, timezone from the server via `RhythmSection` / `LaunchSequenceCard` -> `StartDayButton`), down because the server refuses a future wake time. A stored off-step minute is still listed on the wheel. Test helper `pickTime12` / `readTime12` keep their signatures but drive the pill + wheel.

## 2026-10-07 — This Week's Focus lives in Home's title row (Package C)
Home's header is one slim row from md (768px) up: `Home | focus card | actions` (was: the card dropped to a full-width row below the title until 2xl, ~158px tall with the goals stacked). The card holds Deen and Business side by side, one line each with an ellipsis (full text in a `title` tooltip and in the edit dialog); on a phone the card sits under the title, still two columns, headlines clamped to 2 lines. `PageHeader` children switched from a 2xl to an md breakpoint outright because Home is the only caller that passes children. The Goals button (`GoalsSheetButton`) is now an icon-only flag (`aria-label="Goals"`); the weekend planning nudge is a dot + tooltip on it (plus sr-only text), no longer a text line. An empty slot shows the prompt with a + instead of a pencil. Calendar's version (non-compact) is unchanged. At 1280x800 the Now panel's top moved from 952px to 790px down the page.

## 2026-10-07 — Completing a row: instant strike, ~550 ms beat, 200 ms fade + collapse, then Completed -- and it never comes back (Package F)
`TaskRowList` (Home's Now module, School KPI dialogs) now keeps its local assumptions (completed / removed / delayed / log progress) as plain state in `local`, dropped only when the `items` prop confirms them (row now completed / gone / progress reached), on a failed save, or after a 15 s safety valve. A server list that predates the write (an unrelated refresh) confirms nothing, so it cannot resurrect a row. The exit is a `grid-rows-[1fr]->[0fr]` + opacity transition (`data-exiting` on the `li`), `EXIT_ANIMATION_MS = 200`. A save that fails after the row left puts it back in Pending with its error via `rowErrors` (the row remounts). `PlanList` follows the same rule (`pruneConfirmed`). Any row component that replaces these (Package D's unified Today list) must keep the rule: never derive "completed" from a transition's lifetime.

## 2026-10-07 — "Now" becomes "Today": every task for today in one list, one in focus; prayers + Quran in a "Right now" strip (Package D)
- **Rename, not re-key:** the panel title and the widget manager label say "Today"; the widget key stays `now` so saved layouts keep working.
- **One list:** `buildTodayList` (lib/home/today-list.ts): crown, other starred lines, rest of the plan, then ALL priority items ranked across domains by the real arbiter. The Now-era "one item per domain" and "Kill List contributes only its next line" rules were "next action" rules; Today means all of today's tasks, so Home reads `getPriorityItems(..., { allKillListItems: true })` (opt-in; every other consumer keeps the one-line default). We did NOT widen "today" to overdue tasks: the data layer reads `due_date == today` only (a possible follow-up).
- **Focus:** the row with a running inline timer, else the first pending row; others `opacity-70`.
- **Why Home logs `{ toPage }` after midnight, not `todaysPortion`:** `logQuranReadingCore` computes `todaysPortion` from TODAY's date even with `forDate: "yesterday"`, so it would credit up to a day more than the previous evening's portion the row displays (proved in lib/quran/__tests__/home-post-midnight.test.ts). Logging `{ toPage: displayed .to }` under yesterday credits exactly what is shown, needs no core change (so /deen's button and the MCP twin keep their behaviour), and a stale row is refused by the core with its own message.
- **Row ids are per row:** the Kill List item's id is the constant "kill-list" whichever line is first; keyed bookkeeping would hide line B after ticking line A, so Today rows use `kill-list-<line id>` (the same shape as the completed items).
- **Prayers** left the list for the strip: only the one current prayer, only inside its window, never all at once.
- **Quran reminder window** lives on `user_settings` (migration 261), NULL = default 22:00 -> 01:00.

