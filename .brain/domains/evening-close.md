---
id: domain.evening-close
title: Evening Close / Morning Open / Night Plan
layer: L2
type: domain
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - lib/evening-close/**
  - lib/night-plan/**
  - app/(app)/close/**
  - app/(app)/open/**
  - app/(app)/review/**
related:
  - domain.distractions-checkins
  - domain.business-lockin
  - domain.self-mastery
  - domain.home-arbiter
  - arch.system-overview
answers:
  - "why does close refuse to complete"
  - "does review still exist"
  - "how does the night plan crowning work"
covers: "The nightly close ceremony (with a refusal gate), the read-only morning-open screen, and the dump/star/crown night-plan engine"
excludes: "Distraction plan/trigger mechanics that drive the refusal gate (see domain.distractions-checkins)"
tokens_est: 1268
source_hash: d5b4eb9c315a42a985fce82d55e9c9d8e95ed756ff5a4b3f4e13c2246dee75c9
---

# Evening Close / Morning Open / Night Plan

## Purpose

`/close` is a nightly ceremony that can **refuse to complete**; `/open` is a read-only, ≤2-tap morning confirm-and-start screen. Together they are two halves of one ritual.

## Key concepts

| Term | Means |
|---|---|
| CloseStage | `account\|reflect\|plan\|done` — order is a mechanism enforced by `nextStage()`, not just render order. A blocker at any stage sends the ceremony back to "account." |
| PlanStep | `dump\|star\|crown\|complete` — the Night Plan's 3-phase ritual (dump ideas → star max 3 → crown 1). Crowning an unstarred id is refused; a 4th star is refused, not silently evicted. |
| CloseBlocker | `{kind:"forced_rewrite", triggerId, triggerName}` — the account stage's refusal object, driven entirely by Distractions' `mustRewrite`. |

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Stage mechanism | `lib/evening-close/close-stages.ts` | `planStep`, `nextStage` |
| Refusal gate | `lib/evening-close/evening-close.ts` | `closeBlockers`/`canCompleteClose` — reads `mustRewrite`, never recomputes it |
| Night Plan engine | `lib/night-plan/night-plan.ts` | Pure dump/star/crown/rankedPlan, ported from CollegeOS |
| Close page | `app/(app)/close/{page,actions,plan-actions}.ts` | Account→Reflect→VerdictDueList→Plan |
| Morning Open | `app/(app)/open/page.tsx` | Reads crowned tasks read-only; only write path is a link back to `/close` |
| Review | `app/(app)/review/{page,actions}.ts` | `page.tsx` is a bare `redirect("/close")`; `actions.ts` (`getReviewData`) was DELETED in IA-P1b (the topbar popup is gone; the review is `DistractionPlanReview`, rendered by the close Account stage and Home's Action Plan dialog). IA-P2: the closed day rolls over at 4 AM (`effectiveDayString`), and Home shows Morning/Today/Close-the-day/Done cards (`lib/home/rhythm-state.ts`); `/open`, `/open/today`, `/close/replan` redirect to Home |

## How it works

Account stage computes `closeBlockers()` from distraction triggers; if any current plan `mustRewrite`s, **only** the account stage renders (Reflect/VerdictDueList/Plan are hidden entirely, not disabled). Reflect shows yesterday's crowned three + today's deep-work minutes vs. baseline. `VerdictDueList` renders Self-Mastery lesson-promotion verdicts due today (renders nothing when empty). Plan stage: dump (seeded from school-risk/goal-milestone/worry sources + user-typed) → star 3 → crown 1. `/open` next morning reads that plan back read-only.

## Integration points

| Direction | With | Via |
|---|---|---|
| Depends on | Distractions | The account stage's entire refusal condition is `mustRewrite` |
| Depends on | Business | `work_sessions` (`counts_toward_hours`) feeds Reflect's hours-today figure vs. baseline |
| Depends on | Self-Mastery | `getDuePromotions()` feeds VerdictDueList |
| Feeds | Home / Morning Open | Crowned/starred `tasks` rows (`mit_rank`, `planned_date`) |

## Constraints & gotchas

- `/open` is **unreachable by any static nav link** — direct URL only, deliberately not surfaced in nav.
- The close/open date is always the user's **local** date — this exact bug class ("evening code reading tomorrow's date") has shipped **four times**.
- A dumped-but-unstarred Night Plan line has `domain=null` (migration 119) and is explicitly excluded from the Home arbiter's task query — not an arbiter candidate until crowned/domain-assigned.
- `/review`'s redirect is safe **only because** the account stage absorbed the rewrite UI inline — an explicit warning comment says removing the inline rewrite without removing the redirect would make the close permanently uncompletable for a 3-strike account.

## Not covered here

- Distraction trigger/plan/outcome data model → `domain.distractions-checkins`
- Business focus-minutes computation → `domain.business-lockin`

## Unverified

- None outstanding — the stage mechanism, refusal gate, and redirect behavior were all read directly this pass.

## IA Option A changes (2026-10-04)
- **Day rollover:** the closed day is `effectiveDayString(now, tz, 4)` (`lib/date-utils.ts`): between 00:00 and 04:00 the day being closed is still yesterday. Used by Finish's `evening_closes` date, `planningDateForCore('tonight')` (= closed day + 1), `getEveningCloseData`, Home's rhythm state and `reviewDateFor`. Replan (`'today'`) and Start Day stay on plain local today. See `.brain/memory/decisions.md` (75313d4).
- **Plan stage:** Inbox triage step (`lib/inbox/`, `triageInboxItem`; Finish waits for in-flight "Plan tonight" writes), ends on a "Done for today" block; the **Account stage hosts the one distraction-plan review** (`components/distractions/distraction-plan-review.tsx`, also Home's Action Plan dialog) once nothing blocks.
- **Retired routes → `/`:** `/open`, `/open/today`, `/close/replan` (Re-plan is a dialog on Home's Morning card). `/review` still → `/close`. Today and Review left the nav; the topbar moon link opens `/close` from the wind-down start.

## Plan details + Edit Plan (2026-10-06, migration 260)
- **Edit Plan** replaces "Re-plan": Home's day card opens `ClosePlanStage` (mode `today`) pre-filled with the plan as it stands (`getReplanData` -> `PlanLineState`: star, crown, domain, Kill List, start time, timer, order). Add, remove, reorder (up/down), re-star/re-crown, and change each line's details. The read STARTS on pointer-enter/focus of the button (30 s reuse); `computePlanSeeds`/`getReplanData` read their independent queries in parallel (it was ~8 serial round trips = the "5-6 s").
- **One write:** the stage's Finish / Save is `commitPlan` (`app/(app)/close/plan-actions.ts`): `removePlanLinesCore` -> then `applyPlanDetailsCore` and `savePlanRanksCore` together -> `recordEveningCloseCore` (tonight only). `savePlanRanks` stays as the rank-only entry the MCP tool shares. Removing a TYPED line deletes it; a worry/capture line is only un-planned (never deleted from Worries).
- **A plan line can carry** (all optional): `plan_area` (a `user_domains` key: business/school/work/body/faith/learning/personal_growth; NOT `tasks.domain`), `planned_start_time`, `planned_duration_minutes` (a timer), `plan_order`, `kill_list_item_id`, `timer_started_at`. Pure rules: `lib/night-plan/plan-details.ts`; runner: `plan-details-core.ts`. **School** -> `tasks.domain='school'` + `due_date`=plan day; **Business** -> "Add to Kill List" (preselected) mirrors into that day's Kill List and pairs the rows; **Work** -> a `coop_tasks` Backlog row under the active position-1 target, once per entry into Work (no target = a notice, line stays on the plan).
- **Home plan list** (`components/home/plan-list.tsx`, inside the Now panel, above `NextActions`): `lib/plan/get-plan-items.ts` = today's tasks that are starred OR have a domain OR a start time OR a timer. Order = clock time first, then manual order, then rank (`orderPlanItems`). It REPLACED the old "Today's plan" timebox panel (deleted with `timebox-actions` and `lib/day-structure/timebox.ts`).
- **Start rule** (`lib/plan/plan-behavior.ts#startBehavior`, shared by the button and `startPlanItem`): Business + timer -> timed Deep Work; Business + start time only -> elapsed Deep Work; School (always) -> Deep Study (timed iff a timer); anything else with timing -> inline countdown / elapsed on the row (`timer_started_at`, survives reload); no timing -> Complete only. The server re-derives the behaviour from the row.
- **One row, shown once:** Home's per-domain reads skip a Kill List row owned by a plan line and any task with `plan_area` set (`get-priority-items.ts`); completion is kept in step both ways (`lib/plan/pair-sync.ts`, called from the toggle/set cores).
