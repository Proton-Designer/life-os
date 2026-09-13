---
id: domain.school
title: School
layer: L2
type: domain
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - lib/school/**
  - app/(app)/school/**
  - components/school/**
related:
  - domain.self-mastery
  - domain.home-arbiter
  - domain.mcp-connector
  - arch.system-overview
answers:
  - "how are grades computed"
  - "why is the questions table dead"
  - "what did the CollegeOS merge actually ship for school"
covers: "Class/assignment tracker: classes, assessments, weekly schedule, grade projection, risk scoring"
excludes: "Self-Mastery's separate, unconnected spaced-repetition system (see domain.self-mastery); shared tasks table used by Work too (see domain.work-coop)"
tokens_est: 1376
source_hash: 8680efb479a824b46af3246f27246e7e793cf2ab18a697b96544091309e8eea1
---

# School

## Purpose

A class/assignment/grade **tracker**, not a study or content-generation system: classes, their assessments, a weekly schedule, a due-date task list, a computed per-assignment risk score, and a grade-projection engine. Product opinion: a syllabus upload stores the file — it does not (yet) extract structured data from it.

## Key concepts

| Term | Means |
|---|---|
| Class assessment | `class_assessments`: `weight_pct`, `points_earned`/`points_possible` (migration 106), `is_excused`. Creating one **auto-creates a linked `tasks` row** — one act of entry. |
| Grade engine | `courseGrade.ts`, `grade-projection.ts` — "current grade" (graded weight only) vs. "projected grade" (current average carried across ungraded weight); never treats unassigned weight as zero. |
| Risk engine | `assignment-risk.ts` — 8 weighted factors, ported unchanged from CollegeOS; missing input excludes-and-renormalizes rather than defaulting. Course-level rollup (`course-risk.ts`) has **zero callers** — confirmed dead. |
| `questions` table | Has a real `class_id` FK (migration 111, folded in from the withdrawn `095_school_questions.sql`) but is **confirmed dead**: zero rows, zero code calls `.from("questions")` anywhere. Registered as an MCP read entity under `self_mastery`, not `school`. |

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Core CRUD | `lib/school/actions-core.ts` | Excludes syllabus upload/remove and any real DELETE (MCP guardrail) |
| Grade/risk engines | `lib/school/grades/*`, `lib/school/risk/*` | Pure, each with `__tests__` |
| Data shaping | `lib/school/get-class-cards.ts` | Joins classes+tasks+assessments, computes risk inline |
| Actions | `app/(app)/school/{actions,class-actions}.ts` | `class-actions.ts` also handles raw syllabus upload/remove (Supabase Storage) |
| Entrypoint | `app/(app)/school/page.tsx` | |
| Onboarding | `components/onboarding/school-step.tsx` | 3 branches: upload (file only), manual, Canvas (offered, deliberately not built) |

## How it works

`/school` renders class cards (risk- or date-ranked assessments, this-week task counts) plus a task list. Recent changes (2026-09-10, after this doc's baseline elsewhere): task list default tab is a two-week "Due Soon" window; overdue tasks auto-remove from the list (counted only in the Overdue KPI); mobile PDF-syllabus viewer bug fixed via `navigator.pdfViewerEnabled` branching.

## Integration points

| Direction | With | Via |
|---|---|---|
| Depended on by | Home arbiter / Calendar | Shared `tasks` table (`domain='school'`) |
| External | MCP connector | task/class/class_assessment/schedule_event(+overrides/cancellations); `question` lives under `self_mastery`, not `school` |
| Not connected to | Self-Mastery/ULM | Migration 086 calls connecting a class to ULM ingestion a future "CollegeOS follow-up" — not landed |

## Constraints & gotchas — CollegeOS merge status (re-verified 2026-09-13, all still current)

1. **No grade-entry UI** — `class_grade_ledger.tsx` is pure presentational; nothing writes `points_earned`/`points_possible`. The grade engine is real and correct; it has no live data-entry path.
2. **Syllabus upload is still file-storage-only** — extraction remains "Phase 2" per the onboarding component's own comment.
3. **`questions` table is dead** — confirmed by registry comment (exhaustive grep) and production query (zero rows).
4. **Course-level risk rollup is dead code** — zero callers besides its own test.
5. Migrations 095/096/097 (question bank/attempt log) formally withdrawn 2026-09-02, folded into 111.

## Not covered here

- Self-Mastery's spaced-repetition system → `domain.self-mastery`
- Shared `tasks` table's use by Work/Co-op → `domain.work-coop`
- Detailed feature-by-feature implementation status vs. the original School-Manager/CollegeOS spec → `docs/audits/2026-09-10-school-manager-feature-audit.md` and `docs/audits/2026-09-13-three-app-feature-audit.md` (§"School Core")

## Unverified

- Nothing outstanding — this domain's CollegeOS-merge status was independently re-verified against 2026-09-13 code and found unchanged from the prior 2026-09-10 audit.
