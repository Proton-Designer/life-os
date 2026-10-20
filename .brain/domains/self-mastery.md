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

## Focus reader (2026-10-19)

Every library book is readable in a focus reader (RSVP / page / listen) **independent of LLM ingestion** — reader imports never go through `prepareBookUpload`'s driver-heartbeat + AI-key gate. Design: `.claude/overnight/run-20261019-2250/DESIGN.md`.

- **Data (migration 268):** `books.reader_*` columns (status none/preparing/ready/failed, word count, source, source url, error, doc version) and `ingestion_mode='reader'` (reader-only book: status `ready`, no lessons, no `ingestion_jobs`); `reader_positions` (one bookmark per user+book, written only through the `reader_save_position()` RPC — newest `client_updated_at` wins), `reader_highlights`, `reader_sessions`; `user_settings.reader_*` prefs. All composite-tenancy-FK'd to `books(user_id,id)`, RLS own-row.
- **Document:** one `ReaderDoc` JSON (`lib/reader/types.ts`) in the private `books` bucket at `<uid>/<bookId>/reader-v1.json`. Position = global word index from the ONE tokenizer `lib/reader/tokenize.ts`; changing it invalidates every stored position, so bump `READER_DOC_VERSION`. `source_chunks.text` is NOT reading text (3000-token overlapping LLM chunks) — never reuse it.
- **Import pipeline (`lib/reader/import/`, pure, no DB):** `importFile` (pdf via `lib/self-mastery/ingestion/pdf.ts`/unpdf, epub via fflate + OPF/nav/NCX + linkedom, txt, md, html via Readability), `importPaste`, `importUrl`. `cleanup.ts` strips running headers/footers (a line repeated modulo digits at the top/bottom 2 lines of >=30% of pages) and bare page numbers, de-hyphenates, joins wrapped lines. Failures are always `ReaderImportError(code)` with a human message (`no_text` = scanned PDF, OCR unsupported).
- **URL import SSRF guard (`url.ts`):** the address check runs inside the socket's DNS `lookup` (the checked IP is the connected IP — no DNS-rebinding gap) and on literal IPs; redirects re-checked, max 3; 15 s; 5 MB. `isBlockedAddress` covers loopback/private/link-local/metadata/CGNAT/multicast/v4-mapped v6.
- **Gotchas:** Server Actions cap bodies at 1 MB (no `bodySizeLimit`) — raw source files go via signed upload to Storage, never through an action. `getDocumentProxy` transfers its buffer, so `importPdf` hands pdf.js a copy.

## Not covered here

- School's tracker (unconnected) → `domain.school`
- MCP entity/column detail → `domain.mcp-connector`
- Detailed feature-by-feature implementation status vs. the original ULM spec → `docs/audits/2026-09-13-three-app-feature-audit.md` (§"APP 3 — ULM")

## Unverified

- Whether the upload gate's short-circuit is actually applied at the call site rendering the upload dialog trigger (not traced to source this pass).
