---
id: mem.active-work
title: Active Work
layer: L2
type: memory
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "what is in flight"
  - "why is this code half-migrated"
covers: "In-flight work, partial migrations, recently completed work"
excludes: "Why a past decision was made (see mem.decisions), currently-broken behavior (see mem.known-issues)"
tokens_est: 952
---

# Active Work

**Last reviewed:** 2026-09-13 — verify against git/docs before relying on this
if it's more than ~2 weeks old at the time you read it.

---

## In flight

### Vercel bot-protection exclusion for the MCP connector
**Goal:** exclude `/api/mcp` and `/.well-known/*` from Vercel's automatic bot
mitigation, so a live MCP client session can't be killed mid-flight by a
challenge it can't solve.
**Status:** not blocking, not yet done — a dashboard setting on Ayman's Vercel
account, per `docs/ai-connector/OPERATOR-ACTIONS-PENDING.md` item 3. The
issue has self-cleared twice so far without this fix.
**Do not conflict:** this is a dashboard change, not a code change — nothing
in the repo should be built to "detect" this condition; per the source doc,
the request never arrives when it triggers, so no code of ours can see it.

## Partially migrated

### T-0002 — per-subdomain data scoping for Work (coop_targets/coop_tasks) not shipped
**Old / current:** every Work subdomain shows the exact same shared pipeline/
targets/kill-list data (`app/(app)/work/[subdomain]/page.tsx` re-renders the
plain `WorkPage` regardless of subdomain), with an honest note already
surfaced in `work/[subdomain]/layout.tsx` saying so.
**Planned:** per-subdomain scoping of `coop_targets`/`coop_tasks` (T-0002),
so each Work subdomain's page reflects only its own data — not yet built.
**Rule while this gap exists:** don't assume a Work subdomain's stored
`widgets` column (still written as `[]` from onboarding, still generic
per-subdomain architecture) drives anything — see the paired
known-issues.md entry ("T-0002 (per-subdomain Work data scoping) is still
open — onboarding's inert widget picker has been REMOVED, not fixed").
Ayman ruled (ONB item 8) to remove onboarding's widget-picker step
entirely rather than build it to *look* more correct without T-0002
landing first — that would have just moved the honesty gap, not closed it.
Building a NEW per-subdomain widget-selection UI anywhere still requires
T-0002 first.
**Found:** 2026-09-19, Sonnet ENG 3, ONB item 8 audit — confirmed
independently by Opus Lead. Picker removed 2026-09-19, ONB item 8b.

### AI provider: DeepSeek-only, multi-provider planned but not shipped
**Old / current:** `lib/ai/providers.ts` supports DeepSeek only.
**Planned:** `docs/ai-connector/PROGRAM-PLAN.md` records a ruling to
generalize this beyond DeepSeek to Gemini, Claude, and GPT.
**Rule while this gap exists:** don't assume multi-provider support exists
anywhere downstream (UI, settings, encryption key handling) just because the
plan calls for it — verify against `lib/ai/providers.ts` directly.

### `updated_at` columns requested for School and Work/Business tables
**Status:** documented as requests awaiting migration-number allocation, not
yet confirmed applied — see `docs/ai-connector/SCHOOL-UPDATED-AT-NEEDED.md`
and `docs/ai-connector/WORK-BUSINESS-UPDATED-AT-NEEDED.md`. Check
`supabase/migrations/ALLOCATIONS.md` for the current state before assuming
either is still pending.

## Reference: three-app implementation-status audit (2026-09-13)

Not "in flight" in the usual sense, but the single most current cross-cutting
status check that exists: `docs/audits/2026-09-13-three-app-feature-audit.md`
scored all three merged products against their own spec documents. Headline —
**LifeOS** (the live legacy app) ~92% built as its own team describes it.
**Self-Mastery/ULM** is misleadingly labeled "not yet built" in its own spec but
is ~40% fully implemented plus 22% partial (ingestion, FSRS, review loop are
real — see `.brain/domains/self-mastery.md` for why ingestion is switched off).
**CollegeOS** is ~9% built — mostly still a vision document; only the grade
engine, risk engine, and a capture parser are ported (consistent with
`.brain/memory/decisions.md`'s CollegeOS-merge-is-partial context).

## Recently completed

| What | Notes |
|---|---|
| `mcp_widgets.kind` CHECK widened to 5 kinds (migration 149) | Closes the gap `docs/ai-connector/PROGRAM-PLAN.md` describes — see `.brain/memory/known-issues.md` |
| `pg_cron` MCP scheduled-actions poll registered | `mcp-scheduled-actions-every-5min`, verified firing on schedule with zero audit rows against an empty queue |

<!--
[ ] Under 100 lines   [ ] "Last reviewed" current   [ ] Nothing stale >30 days
-->
