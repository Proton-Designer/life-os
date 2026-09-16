---
id: domain.fitness
title: Fitness
layer: L2
type: domain
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - lib/fitness/**
  - app/(app)/fitness/**
  - components/fitness/**
related:
  - domain.home-arbiter
  - domain.mcp-connector
  - arch.system-overview
answers:
  - "how does fitness tracking work"
  - "why can't the cycle anchor be written"
  - "what can MCP write in fitness"
covers: "Training plans (micro + routine), daily log, body metrics, 4-week measurement cycles"
excludes: "Cross-domain ranking on Home (see domain.home-arbiter); MCP entity/column detail (see domain.mcp-connector, docs/ai-connector/FITNESS-WRITE-SCOPE-DECISIONS.md)"
tokens_est: 1145
source_hash: 442a6cdc5f21501cb9ef13e90e90e3895fc90d2a48860a53f836f6910003748e
---

# Fitness

## Purpose

Exists so the user "can never fool themselves about whether they trained today." Covers structured training plans, a daily log that confirms planned work or accepts ad-hoc entries, body metrics (weight/waist), and a rolling 4-week measurement cycle with benchmarks.

## Key concepts

| Term | Means |
|---|---|
| Two plan slots | `micro` and `routine` (`active_workout_plans`) — zero, one, or both may be active; not mutually exclusive. |
| Plan → session | Confirming a session copies the plan's target sets/reps/load into an immutable `workout_sessions`/`session_sets` snapshot. Logging is confirmation, not free-form entry. |
| Weekly volume | Per-`MuscleGroup` set counts (9 groups; **no leg group exists** — a deliberate 2026-08-19 scope cut, still true today). |
| 4-week cycle | Pure function over a stored `fitness_cycle_anchor.anchor_date`; DST-safe (string arithmetic, no timezone lookup). |

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Entrypoint | `app/(app)/fitness/page.tsx` | Also reached as `/personal/fitness` |
| Plan builder | `app/(app)/fitness/workouts/{page,actions,plan-actions,template-actions}.ts` | |
| Core logic | `lib/fitness/{cycle,volume,daily-log,plan-schedule,progression,rep-goal,week-status,consistency,sync-workout-schedule,actions-core}.ts` | |
| UI | `components/fitness/*`, `components/fitness/workouts/*` | day-grid, cycle-progress-panel, routine-builder, schedule-picker |

## How it works

`FitnessPage` reads `active_workout_plans`, then fans out parallel queries (plans, micro exercises, sessions, cycle anchor, confirmed sets). `buildDailyLog`/`pendingDailyLog` compose today's expected work. Confirming a session or quick-logging inserts append-only rows. Body metrics upsert on `(user_id, date)`.

## Integration points

| Direction | With | Via |
|---|---|---|
| Depended on by | Home arbiter | `buildDailyLog`/`pendingDailyLog` for the day's Fitness candidate |
| External | MCP connector | 15 entities — the largest domain by entity count |

## Constraints & gotchas

- **Fitness had zero real production usage** as of the 2026-08-19 redesign — the entire current data model is a rebuild replacing "an attendance tracker never used."
- **STALE as of 2026-09-16 (Sonnet ENG 3, DFT8 live-verify): `fitness_cycle_anchor` DOES have a write path** — `app/(app)/fitness/page.tsx` (~line 193) upserts an anchor row the first time a user views the page while an active plan exists ("write on a read path," an insert-if-missing keyed on the plan's own creation date, not "today"). Confirmed live: seeding an active micro plan with zero prior anchor rows and loading `/fitness` correctly auto-created the anchor and rendered Cycle Progress. `registry.ts` is still honestly read-only from MCP's perspective (an agent cannot write it), which is a separate, still-true claim from "no write path in the app at all."
- **`active_workout_plans`/`workout_schedule` are deliberately MCP-read-only.** A prior unqualified `ON DELETE SET NULL` made deleting an active plan impossible for weeks (migration 129); `workout_schedule` is fully wiped-and-regenerated on every plan mutation by a shim its own comment calls "the single highest-risk shim in the whole fitness redesign."
- `rep_goals` has zero writers anywhere — a frozen historical artifact.
- Plan-editing machinery (`savePlan`/`deletePlan`/`activatePlan`) is deliberately excluded from the MCP write surface — "known scar tissue."

## Not covered here

- MCP entity/write-scope detail → `domain.mcp-connector`, `docs/ai-connector/FITNESS-WRITE-SCOPE-DECISIONS.md`
- Home's single Fitness candidate row → `domain.home-arbiter`

## Unverified

- Whether `FitnessConfig.style: "plan"|"ad_hoc"` (written at onboarding) has any live downstream effect.
