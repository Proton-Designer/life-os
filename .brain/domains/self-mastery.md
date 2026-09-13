---
id: domain.self-mastery
title: Self-Mastery (ULM — Learning)
layer: L2
type: domain
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - lib/self-mastery/**
  - lib/promotions/**
  - app/(app)/personal/**
  - app/api/self-mastery/**
  - components/self-mastery/**
related:
  - domain.home-arbiter
  - domain.mcp-connector
  - domain.school
  - arch.system-overview
answers:
  - "how does spaced repetition work"
  - "why is book upload disabled"
  - "what is a lesson promotion"
covers: "Book ingestion, FSRS spaced repetition over lessons/cards, the lesson-promotion/verdict loop"
excludes: "School's separate, unconnected tracker (see domain.school); MCP entity detail (see domain.mcp-connector)"
tokens_est: 1293
source_hash: 345ea3c3edf3576841f91fbbc8139bf3974ddb51f5883efda7c6c228d65d3f17
---

# Self-Mastery (ULM — Learning)

## Purpose

Spaced repetition over real material — books → sections → lessons → cards, scheduled by FSRS. The differentiator is a **promotion loop**: a lesson carries an action template, a "promotion" is a commitment to try it, and an append-only verdict log removes adopted lessons from the review deck. The goal is behavior change, not recitation.

## Key concepts

| Term | Means |
|---|---|
| Card types | `free_recall \| application \| cloze \| why` |
| FSRS state | `new → learning → review → relearning`, via `ts-fsrs`. Exactly one scheduler module in the codebase (`lib/self-mastery/fsrs-scheduler.ts`) — both read-side display and write-side grading import `Card` conversion from it. |
| Retrievability vs. desired retention | Retrievability (shown in UI) is not affected by `desired_retention`; that setting only affects *scheduling* (next due date). |
| Meditations deck | A seeded, 12-lesson deck shipped with every account — today the only deck any account actually has. |

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Entrypoint | `app/(app)/personal/[subdomain]/page.tsx` → `SelfMasteryLibrary` | Nav only at `/personal/self_mastery`, no legacy standalone route |
| Ingestion pipeline | `lib/self-mastery/ingestion/*` | chunk, merge, pdf, promotion, summarize, LLM providers |
| Session engine | `lib/self-mastery/session/*` | build-session, offline-queue, plan, queue-limits, timer |
| Scheduler | `lib/self-mastery/fsrs-scheduler.ts` | The one scheduler |
| Ingestion step API | `app/api/self-mastery/ingestion/step/route.ts` | Service-role; one stage per call |
| Promotions | `lib/promotions/*` | `promoteLesson`, `recordVerdictCore`; registered under the MCP `self_mastery` domain |

## How it works

Library reads `books`/`cards`/`card_states`, joined in memory for per-book progress + average retrievability. Starting a session resolves `user_settings`, builds a queue, grades flow client-side through `fsrs-scheduler.ts` with server-side re-validation via the `submit_review` RPC. An offline queue lets a review grade immediately and replay later.

## Integration points

| Direction | With | Via |
|---|---|---|
| Depended on by | Home arbiter | `Area` type explicitly widens to include `"self_mastery"` as a sixth ranked area, same independence as Deen/Fitness |
| External | MCP connector | 12 entities; grading is the newest write path, explicitly **not schedulable** via `scheduler_manage` |
| Not connected to | School | Migration 086 calls connecting a class to ULM ingestion a future "CollegeOS follow-up" — not landed |

## Constraints & gotchas

- **Book upload is disabled in this deployment.** `ingestion-availability.ts` gates on `SELF_MASTERY_INGESTION_URL` being set (deliberately not on a BYO key) — confirmed absent locally; asserted absent in production by docs, not independently re-verified against Vercel env vars.
- Migration 115's `personal_growth` flatten **silently broke** Self-Mastery nav in production (200-with-redirect, nothing errored) until `lib/shell/nav-domain-state.ts` synthesized the three personal areas from flat keys — that fallback is live code, not dead code.
- `lib/self-mastery/untyped-from.ts`'s header comment is confirmed stale (books/lessons/cards ARE now in the generated DB type) — tracked in `docs/ai-connector/KNOWN-STALE-COMMENTS.md`, left as low-priority cleanup.

## Not covered here

- School's tracker (unconnected) → `domain.school`
- MCP entity/column detail → `domain.mcp-connector`
- Detailed feature-by-feature implementation status vs. the original ULM spec → `docs/audits/2026-09-13-three-app-feature-audit.md` (§"APP 3 — ULM")

## Unverified

- Whether the upload gate's short-circuit is actually applied at the call site rendering the upload dialog trigger (not traced to source this pass).
