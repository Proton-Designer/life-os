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
