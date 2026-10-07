---
id: domain.business-lockin
title: Business / Lock-In
layer: L2
type: domain
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - lib/business/**
  - app/(app)/business/**
related:
  - domain.work-coop
  - domain.home-arbiter
  - domain.insights
  - domain.distractions-checkins
  - domain.mcp-connector
  - arch.system-overview
answers:
  - "how does the kill list work"
  - "how is signal:noise computed"
  - "what is a lock-in session"
covers: "The 3-item daily Kill List, weekly business goal, Lock-In deep-work/deep-study sessions, Signal:Noise ratio"
excludes: "Work/Co-op targets and task pipeline (see domain.work-coop, shares work_sessions); check-in allocation mechanics (see domain.distractions-checkins); Insights' rendering of Signal:Noise (see domain.insights)"
tokens_est: 1336
source_hash: 5225382b8ed7271aca201005c376bee64598bb5fa58e568550c928561e472761
---

# Business / Lock-In

## Purpose

The owner's personal daily-focus system: a capped 3-item "Kill List," a weekly business goal, and "Lock-In" deep-work/deep-study sessions, measured against a Signal:Noise ratio of tracked time spent on ranked-essential work versus everything else.

## Key concepts

| Term | Means |
|---|---|
| Kill List | `kill_list_items` — exactly 3 fixed slots/day, independently completable, no cross-day linking (an unfinished item disappears at midnight — a deliberate, documented gap). |
| Weekly goal | `weekly_goals` — `headline` + `milestones` jsonb array, **no per-milestone completion state** (a stated, unfixed structural gap). Shared table with Deen's weekly goals via a `domain` column. |
| Signal:Noise | `domain-classification.ts` classifies each domain as signal, other, or unrecognized. Legacy fallback (`weights===null`) hardcodes `deen`+`business` = signal — still used everywhere for `business`/`co_op` since neither has a real weight-model mapping yet. |
| Session goal/objectives | Migration 146 (landed 2026-09-08→13): a Lock-In session can carry a `goal_minutes` target and a checklist of kill-list items / school tasks / one custom line. |

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Kill list | `lib/business/{kill-list-slots,kill-list-cleared}.ts` | |
| Session goal | `lib/business/{session-goal,session-objectives,active-session}.ts` | `getActiveWorkSession(Detail)` feeds AppShell, Home Focus, `/business` |
| Signal:Noise | `lib/business/{domain-classification,domain-weights,sn-ratio,sn-trend}.ts` | |
| Actions | `app/(app)/business/{actions,kill-list-history-actions}.ts` | |
| Entrypoint | `app/(app)/business/page.tsx` | |

## How it works

Business page shows Kill List, weekly goal, and last/active session. Starting a Lock-In session can prompt for duration + objectives. Ending happens manually, on goal-reached (auto-end at exactly `startedAt+goalMinutes`), or when all objectives are checked (auto-end at real `now()` — the one case that legitimately uses wall-clock time). Objective completion for kill-list/task kinds is **never mirrored** — always derived live from the referenced row, so toggling from either the panel or the overlay can never desync.

### Plan-linked sessions: Pause / Resume / Mark Done (Package E)
A session Home's Today list starts from a plan line works on exactly ONE plan task (a `task` objective, or the line's paired Kill List objective). Its overlay shows **Pause** and **Mark Done** instead of End Session (`session.planTaskId`, from `getActiveWorkSessionDetail`, which also returns `bankedSeconds`); any other session keeps End Session exactly as before. Every way a session ends (End Session, both auto-ends, Pause, Mark Done, the MCP end op) goes through `endSessionAndBankCore` (`lib/night-plan/plan-work-core.ts`): `endWorkSessionCore` (now returning true only when THIS call ended it) and, only then, the DB-recorded `ended_at - started_at` is banked into `tasks.timer_elapsed_seconds` (migration 262), so a retry or double tap banks nothing twice. Resume is `startPlanItem` again: a new session whose goal is what is left of the line's timer (`remainingGoalMinutes`), or open-ended.

## Integration points

| Direction | With | Via |
|---|---|---|
| Depended on by | Home arbiter | Kill-list next-incomplete item; deep-work minutes/session count |
| Shares with | Work/Co-op | `work_sessions`, active-session cache, `work_session_objectives` |
| Depended on by | Insights | Signal:Noise donut/6-week trend, sole source is `checkin_allocations` |
| Depended on by | Distractions | Commit `bdda3f4`: distraction domain can be inferred from an active Lock-In session |
| External | MCP connector | 2 entities: kill_list_item, weekly_goal (`fixedFilter: domain='business'`) |

## Constraints & gotchas

- `kill_list_items`/`weekly_goals` had **zero rows in production** as of 2026-08-18; as of the 2026-09-08/09 snapshot, usage has started (~8 rows) — a real state change, not a redesign; don't assume either "never used" or "heavily used."
- Milestones still have no per-item completion — flagged in 2026-08-18 research as "a weekly goal you cannot make progress against is a poster, not a system"; unresolved.
- **`work_sessions.updated_at` is load-bearing for MCP's cheap resync** — any new write path that doesn't go through an `UPDATE` (triggering the touch trigger) will silently make the connector think the row is unchanged.

## Not covered here

- Work/Co-op targets and pipeline → `domain.work-coop`
- Check-in allocation windows → `domain.distractions-checkins`
- Insights' Signal:Noise rendering → `domain.insights`

## Unverified

- Whether `lib/checkins/`'s missed-hour-as-noise rule still matches `docs/superpowers/specs/2026-08-19-missed-lockin-hours.md` exactly (not independently re-checked against current `lib/checkins/` code this pass).
