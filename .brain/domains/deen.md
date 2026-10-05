---
id: domain.deen
title: Deen (Faith Practice)
layer: L2
type: domain
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - lib/deen/**
  - lib/prayer-times/**
  - app/(app)/deen/**
  - components/deen/**
related:
  - domain.home-arbiter
  - domain.mcp-connector
  - domain.settings-onboarding
  - arch.system-overview
answers:
  - "how does prayer tracking work"
  - "where is qada backlog computed"
  - "how do prayer time windows work"
  - "why is windows.ts the only safe prayer-time entry point"
covers: "Five daily prayers with real astronomical windows, Qur'an reading, sunnah tracking, the habit-builder pipeline, tiered reflection, Qada backlog"
excludes: "Cross-domain ranking of Deen items on Home (see domain.home-arbiter); Evening Close's distraction gate (see domain.evening-close); MCP entity wiring detail (see domain.mcp-connector)"
tokens_est: 1587
source_hash: b0917d531a806a5e7ffdbc1dea097d37fd238e53439eabef9b69435badeaf325
---

# Deen (Faith Practice)

## Purpose

Answers "how am I actually doing at daily religious practice," not "did I check a box." Covers the five daily prayers against real computed time windows, Qur'an reading, sunnah (rawatib) tracking, a habit-builder pipeline, a private tiered reflection log, and a Qada (missed-prayer makeup) backlog — all derived at read time, never pre-computed and stored.

## Key concepts

| Term | Means |
|---|---|
| Prayer window | `[start, end)` per prayer; Isha's window extends to tomorrow's Fajr. Can be `null` at extreme latitudes — never derive "missed" from a null window. |
| Effective status | `upcoming\|pending\|on_time\|qada\|missed`, derived at read time from a stored status (`on_time\|qada\|missed\|unlogged`) plus the window. |
| `unlogged` | An MCP-only "undo" status (migration 143) — behaves exactly like "no row" everywhere. The app's own UI does a real `DELETE` instead. |
| Tracking floor | `tracking_started_on` — the date before which nothing can be derived as "missed," protecting against wiping history and having every prior day reconstructed as missed. |
| Habit stage | `active_build → stabilized → locked`, a pure function of days-since-commit (0-13/14-29/30+); streak does **not** gate stage promotion. |
| Faith depth | `prayers_only < prayers_quran < full_practice` (migration 114). Gates rendering only, never deletion. **Zero callers today** — landed, unwired. |

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Entrypoint (UI) | `app/(app)/deen/page.tsx` | Also reached as `/personal/faith` (composed, not duplicated) |
| Prayer window math | `lib/prayer-times/windows.ts` | `computePrayerWindows` — the **only** safe entry point |
| Prayer math (naive) | `lib/prayer-times/calculate.ts` | Timezone-naive by design; trusts the UTC Y/M/D it's handed |
| Core write path | `lib/deen/actions-core.ts` | Shared by cookie-authed actions and MCP writes |
| Actions | `app/(app)/deen/actions.ts` | Server Actions: mark prayer, toggle sunnah/adhkar, log Qur'an, habit CRUD |
| Derivations | `lib/deen/{prayer-status,prayer-streak,prayer-consistency,qada-backlog,qada-progress,sunnah,habit-stage,habit-streak,habit-consistency,reflection-*,quran-trend,faith-depth}.ts` | Pure calculation modules |
| UI | `components/deen/*` | prayer-row, habit-builder, reflection-tracker, qada-backlog-card, sunnah-disclosure, salah-calendar-dialog |

## How it works

1. `DeenPage` runs one 8-way `Promise.all` (prayers, quran_sessions, weekly_goals, reflection_entries, deen_habits, deen_habit_logs, deen_weekly_focus, sunnah_logs; 60-day range).
2. Prayer statuses resolved once via `resolvePrayerStatuses`, floored at `tracking_started_on`.
3. Marking a prayer / toggling sunnah / logging Qur'an / habit CRUD go through Server Actions, mostly thin wrappers over `actions-core.ts` functions shared with MCP.

## Integration points

| Direction | With | Via |
|---|---|---|
| Depended on by | Home arbiter | `computePrayerWindows` for the "next prayer" candidate and day-shape ribbon (`lib/home/get-priority-items.ts`, `get-day-shape.ts`) |
| Depended on by | Check-ins | Suppresses check-in prompts during a prayer window |
| External | MCP connector | `deen` domain, 8 entities (prayer, sunnah_log, adhkar_log, quran_session, reflection_entry, deen_habit, deen_habit_log, deen_weekly_focus) |

## Constraints & gotchas

- **`components/settings/location-settings.tsx` hand-duplicates the local-day anchor** rather than calling `computePrayerWindows` (fixed after a 2026-08-31 incident showed tomorrow's prayer times after ~19:00 local for months). A future edit to `windows.ts`'s anchor logic will **not** propagate here — grep for it if you touch the anchor.
- **Adhkar/Traveling are hidden from the UI, not dead.** `toggleAdhkar` is still live and MCP-write-reachable even with zero human-facing UI for it — an AI agent can toggle a user's adhkar log with no button existing. `qada-counter.tsx` (superseded by `qada-backlog-card.tsx`) is genuinely dead.
- `user_domains.depth` has zero consumers (`faith-depth.ts` is tested, uncalled) — a landed, unwired feature, not a bug.
- The `dispatch-notifications` Edge Function has its own prayer-time-shaped function separate from `lib/prayer-times/`; whether it shares the anchor-fix safeguard is **unverified**.

## Deen Mode (2026-10-04)

`profiles.deen_mode boolean not null default false` (migration 251) is the single switch for everything religious; read it with `isDeenModeOn(profile)` (`lib/deen/deen-mode.ts`, strict `=== true`, fails closed). OFF is a render/behaviour gate only — no deen table or `user_domains` row is ever deleted or mutated by toggling. Written only via `updateProfile({ deen_mode })` (Settings → Features → `DeenModeSettings`); deliberately not MCP-writable. Settings gating (done): Prayer panel and the whole Location panel (every lat/lng/label consumer is prayer-only) + their side-nav entries hidden when OFF; `timezone` (app-wide) is split out into `TimezoneSettings`, shown instead of Location when OFF; `hidden_features` "deen" no longer listed in the visibility UI (stored value tolerated and preserved). Behaviour gates (DEEN-06): `dispatch-notifications` skips the prayer push unless `deen_mode` (pure gate in `supabase/functions/dispatch-notifications/gate.ts`, a deliberate duplicate of `isDeenModeOn` since the edge runtime can't import `lib/`; **needs an edge-function redeploy**); the allocation check-in reads no prayer data, applies no prayer-window suppression and hides the Deen row when OFF (`AllocationQueueResult.deenMode` → queue context → `AllocationCheckin showDeen`); `lib/distractions/actions-core.ts` refuses a new `deen`-domain trigger or a reflection tier when OFF (existing rows untouched). Other surfaces (nav/routes/actions: DEEN-03; Home: DEEN-04; MCP) are covered by their own tasks.

**AI connector gate (DEEN-07, user decision A2):** with Deen Mode OFF the `deen` domain is invisible and refused to agents. One module, `lib/mcp/deen-gate.ts` (`assertDeenAvailable`, fails closed), is called by `readTool`, `writeTool` (covers scheduled fires and widget rendering), `list_capabilities(domain)`, `widget_manage` create/update and `scheduler_manage` create — each after pure shape validation and before any DB access; refusal is a `ToolInputError` (400 `invalid_input`). `buildAccountMap` omits the deen domain and the faith area/vocabulary; `settings.profile` reads drop the prayer-only columns (calc method, madhab, location, qada, traveling); deen widgets are neither listed nor rendered. Deen-flavoured rows inside NON-deen entities are filtered from agent reads while OFF (DEEN-07b): `distractions.trigger` and `checkins.allocation` (domain ≠ deen, NULL kept), `distractions.event` (no reflection-linked events or deen-trigger events; reflection columns dropped), `distractions.action_plan` and `distractions.plan_outcome` (no rows of deen-domain triggers, DEEN-07c), `widgets.widget`, and `scheduler_manage list` (schedules aimed at deen). The cookie `saveAllocationCheckin` treats ANY non-null, non-zero `deen` value as Deen minutes. Data is never touched. `deen_mode` is not in any write-registry patch shape (asserted by test). `lib/deen/actions-core.ts` is not gated itself: its only non-cookie callers are the `deen` write handlers, all behind `writeTool`.

**Other gated surfaces (2026-10-04, shipped):** nav/routes/Server Actions (DEEN-03: `/deen` redirects, `lib/deen/deen-mode-guard.ts`), Home modules and snapshot (DEEN-04: deen reads are skipped, not fetched-then-hidden), goals tagged `deen` (DEEN-08b: `lib/goals/deen-filter.ts`, `getDeenGoalIdsForMonth`; Evening-Close plan seeds exclude them; `getTodayDistractionCount` excludes deen-trigger events), realtime sync (skips prayers/sunnah/habit-log tables), the allocation check-in server refusal (`assertDeenMinutesAllowed`: any non-null, non-zero `deen` minutes are refused), the AI connector (above), and a Playwright state route `app/api/test/deen-mode` (secret-gated, own profile only) used by `e2e/deen-mode-helpers.ts`. Onboarding has no faith step (see `domain.settings-onboarding`); Settings → Features is the only way in. OFF → ON restores everything because nothing is ever deleted.

**Qada preview window (QADA-3M / QADA-3M-b):** the Qada backlog preview on the Deen screen and Home's "n qada" doorway both count the last 3 calendar months via ONE definition, `qadaWindowStart(todayStr)` in `lib/deen/qada-backlog.ts` (calendar arithmetic on the user's LOCAL date string, month-end clamped: May 31 → Feb 28/29). `tracking_started_on` still floors it (`computeTrackingFloorDateStr`). Home derives its old-range count from a head-only handled count over the same window, so the two numbers agree (pinned by a parity test with a 67-day-old miss).

- **Faith practices on Home / weekly reset (HABITS-01, 2026-10-04):** `lib/deen/practices.ts` (`getFaithPractices`, `buildFaithPractices`) is the ONE derivation of a practice's streak / 30-day rate / stage; the Faith page, Home check-offs and /week step 3 all use it. Callers read it only when Deen mode is on. Writes reuse `setDeenHabitLogStatus` (absolute tick, no revalidate) + `refreshFaithPracticeViews` (data-free, debounced) and `archiveDeenHabit` (revalidates /deen, / and /week). No migration.

- **Habit frequency (HABIT-FREQ, 2026-10-05, migration 259):** a habit is no longer implicitly daily. `deen_habits` AND `identity_habits` (the /habits board) both carry `frequency_type` (`daily` default | `weekdays` | `per_week` | `per_month` | `every_n_days`) + `frequency_count` / `frequency_days` (0=Sun) / `frequency_interval`, one shape CHECK per table. `lib/habits/frequency.ts` is the ONE pure model (validate, label, due-today, period progress, streak, adherence, expected rate, grid cells) and `components/habits/frequency-picker.tsx` the ONE picker; every reader goes through them (`lib/deen/practices.ts`, `lib/habits/queries.ts`, Home check-offs, evening-close, weekly review). Logs are UNCHANGED (still one row per habit/date; a flexible habit's progress is a count in the period). Weeks are Sun-Sat; a habit's FIRST partial week/month only owes what the period can still hold. Identity decay is per EXPECTED gap (`0.96^rate`, `computeHabitDecayScore`'s `ratePerDay`) so a weekly habit isn't punished on its off days. Home shows only habits DUE today (plus already-ticked). Flexible habits read 400 days of logs (`FLEXIBLE_LOOKBACK_DAYS`), daily ones keep 60. MCP: `frequency` on `deen.habit.create` / `habits.identity_habit.create`, `set_frequency` on both. Cue-time ribbon blocks only draw for daily / certain-days habits.
- **Prayer streak (2026-10-05):** counts only days with ALL FIVE prayers `on_time` (Qada breaks the day), computed from the user's whole on-time history (`getOnTimePrayerDays`, paged) so it is not capped at 60 days; the card also shows the longest streak ever (`computeLongestPrayerStreak`).

## Not covered here

- Evening Close's distraction-plan refusal gate → `domain.evening-close`
- MCP entity/column-level wiring → `domain.mcp-connector`
- Push-notification dispatch mechanics → `.brain/tooling/integrations.md`

## Unverified

- Whether `FitnessConfig.style`-equivalent onboarding choices affect Deen rendering (none found).
- Whether the Edge Function's own prayer-time math shares `windows.ts`'s anchor fix.
