---
id: mem.active-work
title: Active Work
layer: L2
type: memory
status: canonical
owner: unassigned
updated: 2026-10-25
answers:
  - "what is in flight"
  - "why is this code half-migrated"
covers: "In-flight work, partial migrations, recently completed work"
excludes: "Why a past decision was made (see mem.decisions), currently-broken behavior (see mem.known-issues)"
tokens_est: 952
---

# Active Work

**Last reviewed:** 2026-10-04 — verify against git/docs before relying on this
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

### Focus reader in Self-Mastery (overnight run 2026-10-19/20)
**Goal:** every Self-Mastery library book opens in a focus reader (RSVP / page view, narration, highlights, stats). **Status:** SHIPPED 2026-10-20 01:20 CDT — `659d410` deployed to production (tracking-lur6c1v6h…); migrations 268, 269 and 270 (unique `reader_sessions` stretch key, applied after the deploy and proven to reject a duplicate in a rolled-back insert) are live. Not yet tried on a real iPad/phone. Migration ledger: 266/267 columns exist live but are unrecorded (pre-existing, from an earlier run) — record them. Open lows: see known-issues "Open lows from the Focus reader run". Decisions: `mem.decisions` 2026-10-20.

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

### AI provider: multi-provider shipped; the connector replaces the BYO key (resolved 2026-10-25)
**Now:** `lib/ai/gateway.ts` routes every AI feature through the person's OWN saved provider and key: DeepSeek, Claude, OpenAI, Gemini, Kimi or Grok (`lib/ai/providers.ts`, `lib/ai/reasoning.ts`, `lib/ai/model-catalog.ts`). There is no shared or operator-funded key. Live-verified for DeepSeek only; the other providers are pinned by recorded request/response shapes (`lib/ai/__tests__/ingestion-provider-shapes.test.ts`), and a few catalog ids are flagged stale in `lib/ai/model-catalog.ts`.
**Ruling (Ayman, 2026-10-25, `decisions.md`):** the MCP / PAT connector exists to REPLACE the BYO AI key. Every in-app AI feature has a no-key path that a scheduled agent (Claude / ChatGPT) fills through MCP; a key stays optional, for instant results. A feature with neither shows "Connect an agent or add a key", not an error.
**How each kind of AI work is covered without a key:** scheduled outputs (Morning Brief, weekly review narrative, session-closer day connection) are written with `day.morning_brief` / `review.weekly_narrative` / `self_mastery.day_connection` write ops; request-triggered work (syllabus, announcement, question drafts incl. transcripts, answer feedback, teach-back, and every model step of book ingestion) goes through the agent work queue (`agent.job`). Details: `.brain/domains/mcp-connector.md`. Not covered by an agent path: transcription (needs audio) and embeddings (they use the owner's embeddings key when they have one, otherwise are skipped).

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
| IA Option A "Rhythms" (P1–P4, run 20261004-1135) | Home rhythm card, `/week` reset, Insights Week tab, Launch sequence + Wind-down, Work tabs, one capture/review/goal editor — see `.brain/memory/decisions.md` (2026-10-04) and the `.brain/domains/*` notes; deferred: step reorder, MCP twins (`pending` in `lib/mcp/parity-manifest.ts`), per-tab Work data |
| Agent-connector program, steps 1-4 (2026-10-25, migrations 274-281) | Step 1: agent-written Morning Brief (274). Step 2: weekly review narrative (275) and session-closer day connection (276). Step 3: generic agent work queue `agent_jobs` (277, claimed_by tenancy 278): announcement / syllabus / question-draft jobs, transcript drafting, "feedback later" answer feedback and teach-back (280, `ai_feedback_notes`), idempotent apply, and the `jobs` token scope that confines the queued-work agent (279). Step 4: book ingestion with no key (281): model stages planned per unit, ingestion job parked while the agent works, keyed by unit id, stage writes shared in `stage-apply.ts`, upload estimate, "Waiting for your agent: X of N steps" with Cancel. Live-proved on seed-domains with a jobs-only PAT (3-chapter book -> ready, 5 lessons, 20 cards). Docs: `.brain/domains/mcp-connector.md`, `.brain/domains/self-mastery.md`, `docs/ai-connector/CAPABILITIES.md` |
| `pg_cron` MCP scheduled-actions poll registered | `mcp-scheduled-actions-every-5min`, verified firing on schedule with zero audit rows against an empty queue |

<!--
[ ] Under 100 lines   [ ] "Last reviewed" current   [ ] Nothing stale >30 days
-->
