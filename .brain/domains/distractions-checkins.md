---
id: domain.distractions-checkins
title: Distractions + Check-ins
layer: L2
type: domain
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - lib/distractions/**
  - lib/checkins/**
  - app/(app)/distractions/**
  - app/(app)/checkin/**
related:
  - domain.evening-close
  - domain.business-lockin
  - domain.insights
  - arch.system-overview
answers:
  - "how does the 3-strike distraction rule work"
  - "how does the allocation check-in model work"
covers: "One-tap distraction capture + 3-strike forced-rewrite discipline; periodic time-allocation check-ins"
excludes: "The evening-close refusal gate itself (see domain.evening-close); Signal:Noise computation that consumes checkin_allocations (see domain.insights, domain.business-lockin)"
tokens_est: 1221
source_hash: 9fda6961221422f3bdee0270e077728c2fa9f510633153a224a69fe6520ed0f5
---

# Distractions + Check-ins

## Purpose

Distractions: one-tap capture of "this just happened" without breaking flow, plus a 3-strike forced-rewrite discipline so a repeatedly-failing avoidance plan can't be silently re-confirmed. Check-ins: periodic, low-friction sampling of how the last time block was actually spent, replacing end-of-day memory reconstruction. Neither has a standalone page — both are dialog/action-only, reached from Home's topbar and Evening Close.

## Key concepts

| Term | Means |
|---|---|
| Trigger → event → plan → outcome | `distraction_triggers` → `distraction_events` (a tap, optional tiered reflection) → `trigger_action_plans` (versioned, one "current" per trigger) → `trigger_plan_outcomes` (followed/skipped, one per trigger/day). |
| `mustRewrite` | `skippedCount>=3 && followedCount===0` on the current plan version — a plan ever followed is never force-rewritten. |
| Review window | 21:00 through a 4am tail next morning — deliberately not plain midnight, so post-midnight review of yesterday isn't silently rolled to a new empty day. |
| Allocation model | Fixed 120-minute clock tiled from wake to sleep; each window divides the pool across domains + a derived `wasted` remainder. Replaced a point-sample model after it shipped with near-zero real usage. |
| `is_wasted` (migration 108) | Split from a shared domain/"wasted" namespace so a future domain literally named "wasted" can't silently merge into unaccounted time. |

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Distractions core | `lib/distractions/{types,plan-rules,queries,actions-core}.ts` | |
| Distractions actions | `app/(app)/distractions/actions.ts` | Capture/create/update/save-plan/record-outcome |
| Check-ins core | `lib/checkins/{schedule,allocation,get-allocation-queue,session-hour-status,missed-hour-queries,prefill,compute-session-checkin-slots}.ts` | |
| Check-in actions | `app/(app)/checkin/{allocation-actions,session-hour-actions}.ts` | |
| RPCs | `save_allocation_checkin`, `save_trigger_plan`, `record_plan_outcome` | Atomic; idempotent on `(user_id, window_start)` |

## How it works

Capture inserts a `distraction_events` row (+ optional linked `reflection_entries` row). Review (topbar dialog or Evening Close's account stage) groups triggers, computes `mustRewrite` per plan. Allocation: `resolveAllocationSlots` computes every window's state for the day; a fired window is answerable for 30 minutes then permanently `expired_unknown`; inside an active Lock-In session the 2-hour clock is suppressed for an hourly cadence.

## Integration points

| Direction | With | Via |
|---|---|---|
| Feeds | Evening Close | `mustRewrite` state is the account stage's entire refusal condition |
| Feeds | Insights / Signal:Noise | `checkin_allocations` is the sole data source |
| Feeds | Home Focus panel (not the arbiter) | Trigger/today-count |

## Constraints & gotchas

- The legacy point-sample `checkins.kind='point'` model is schema-preserved and explicitly still readable per its own migration header — **unverified** whether any live UI path still *writes* a point-kind row.
- Both systems' domain vocabulary is still the frozen 5-value legacy set — neither has been widened to the `personal_growth`-flattened or Work-subdomain vocabulary yet.

## Not covered here

- The refusal gate mechanism itself → `domain.evening-close`
- Signal:Noise computation → `domain.business-lockin`, `domain.insights`

## Unverified

- Whether `checkins.kind='point'` has any live writer remaining.
