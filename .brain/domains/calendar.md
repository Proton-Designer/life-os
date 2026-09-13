---
id: domain.calendar
title: Calendar
layer: L2
type: domain
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - app/(app)/calendar/**
related:
  - domain.school
  - domain.work-coop
  - domain.deen
  - arch.system-overview
answers:
  - "how does the week calendar work"
covers: "A Sun-Sat hour-grid week view, read-mostly beyond the weekly-goal headline"
excludes: "Deadline/task data itself (owned by School/Work — see domain.school, domain.work-coop)"
tokens_est: 600
source_hash: bd41aafb2da90e59db5964e3ef863f7f58c6206b710ad8435107df312be630c5
---

# Calendar

## Purpose

A Sun–Sat hour-grid week view — read-mostly, not editable inline beyond the weekly-goal headline. No day view, no drag-to-reschedule, no external calendar import (explicit non-goal).

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Entrypoint | `app/(app)/calendar/page.tsx` | 42 lines |
| Data | `app/(app)/calendar/actions.ts` | `getWeekCalendar()` — the one shared Server Action, backs both the standalone page and a topbar popup dialog (one component, two fetch wrappers) |

## How it works

Fetches `schedule_events` (School/co_op, recurring + one-off), `weekly_goals`, `tasks`, active fitness plan, Qur'an-session rows in one `Promise.all`; assembles `CalendarItem[]` blocks. A dumped-but-unassigned Night Plan line (`domain:null`) renders with a real "Planned" label rather than a blank.

## Integration points

| Direction | With | Via |
|---|---|---|
| Reads | School/Work | `schedule_events`, `tasks` |
| Reads | Fitness | Active plan |
| Reads | Deen | `weekly_goals`, Qur'an sessions |
| Feeds nothing back | — | Pure read surface |

## Constraints & gotchas

- Uses `resolveLocalTime`, never `` `${ws}T00:00:00Z` `` string construction — same Saturday-evening-misfiled-into-wrong-week bug class documented elsewhere in the codebase.
- Uses `getUserDomains()` to scope `weekly_goal_domains`, avoiding a hardcoded `["deen","business"]` that would silently exclude a user who deselected Faith.

## Not covered here

- Task/deadline/schedule-event data ownership → `domain.school`, `domain.work-coop`

## Unverified

- None outstanding.
