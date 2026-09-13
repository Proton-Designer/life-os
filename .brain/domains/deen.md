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

## Not covered here

- Evening Close's distraction-plan refusal gate → `domain.evening-close`
- MCP entity/column-level wiring → `domain.mcp-connector`
- Push-notification dispatch mechanics → `.brain/tooling/integrations.md`

## Unverified

- Whether `FitnessConfig.style`-equivalent onboarding choices affect Deen rendering (none found).
- Whether the Edge Function's own prayer-time math shares `windows.ts`'s anchor fix.
