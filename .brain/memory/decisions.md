---
id: mem.decisions
title: Decisions
layer: L2
type: memory
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "why was X chosen"
  - "why do we do it this way"
  - "was Y considered"
covers: "Decisions made, alternatives considered, what superseded what"
excludes: "Work currently in progress (see mem.active-work), currently-broken behavior (see mem.known-issues)"
tokens_est: 1455
---

# Decisions

Newest first. Full reasoning lives in the dated source doc under
`docs/superpowers/` — these entries are pointers with the load-bearing
conclusion, not a replacement for reading the original when it matters.

---

## 2026-09-15 — MCP `school.task.edit` is MERGE semantics; the UI's own edit form stays full-replace

**Status:** Active — Opus Lead ruling, P4-08 (overnight run-20260915-0011)
**Source:** `.claude/overnight/run-20260915-0011/board/03-in-review/P4-08-write-coverage-school-qbank-ulm.md`

**Decision:** Calling `write(domain:"school", entity:"task", action:"edit", id, patch)` through MCP now merges — a field the caller omits from `patch` keeps the task's current value, rather than being cleared. `due_date` and `task_type_other_label` accept an explicit `null` in the patch to clear them (the one thing MERGE semantics would otherwise remove versus the old behavior, where simply omitting a field cleared it). The app's own task-edit form, and `lib/tasks/actions-core.ts#updateTaskCore` itself, are UNCHANGED — still full-replace. The merge happens entirely inside the write-registry.ts handler: it reads the existing row, resolves each field (`patch.field === undefined ? existing.value : <validated from patch>`), then calls the same, untouched `updateTaskCore` with the fully-resolved values.

**Why:** An AI agent calling this tool typically wants to change ONE field ("push this task's due date back a day") without first reading back and re-sending every other field — full-replace makes that a lossy trap (omit `class_id` by accident, and the edit silently unlinks the task from its class). The UI's own edit dialog already always has the full row in hand (it's editing a form pre-filled from that row), so full-replace costs it nothing and stays as-is — only the MCP write path's shape needed to change.

---

## 2026-08-19 — A missed Lock-In hour resolves to `wasted`, and every hour stays editable

**Status:** Active — ruled by Ayman 2026-08-19 16:45 CDT
**Source:** `docs/superpowers/specs/2026-08-19-missed-lockin-hours.md`

**Decision:** An unanswered check-in hour, once superseded by a newer slot,
derives to `wasted` automatically (no cron — same derive-don't-write pattern as
`lib/deen/prayer-status.ts`). Every hour, during or after the session, stays
editable between signal and wasted.

**Why:** This reverses an earlier same-day ruling that treated silence as
"unknown, not noise." That was defensible on consistency grounds, but it
created a loophole: ignoring every hourly prompt scored as full signal with no
visible trace. Ayman: *"a missed check in during lock in session should be
counted as noise, but the user can go back and update/change status."*

**Consequences:** `subtractConfirmedHours` was renamed
`subtractResolvedHours` and widened to cover answered ∪ missed hours, to avoid
double-counting coarse Lock-In overlap credit against an hour already resolved
to a precise value.

**Do not undo without understanding:** auto-marking without editability would
punish being deep in work or away from a phone; editability without
auto-marking reopens the silence loophole. Ship both together or neither.

---

## 2026-08-18 — Business section: subtraction, not hours, is the lever; ship framing before redesign

**Status:** Active — synthesis for Ayman's decision, from two research tracks
**Source:** `docs/superpowers/specs/2026-08-18-business-brainstorm-synthesis.md`

**Context:** `kill_list_items` and `weekly_goals` had zero rows each, despite
both existing in the schema. Research covered productivity-book claims (Musk,
Hormozi, Jobs, O'Leary) that partly conflict on whether more hours or more
subtraction produces output.

**Decision (R1–R5, ranked):**
- **R1** — frame both empty modules: say what the thing is, why three slots,
  give one example. Copy, not architecture; addresses the actual problem the
  zero-row evidence points at.
- **R2** — keep all three Kill List slots visible permanently, slot 1 open and
  required with slots 2–3 behind "+ add another" — every day, not just a
  first-run special case (a first-run-only version of this was considered and
  rejected: one item has no trade-off, so it teaches a different, easier
  exercise than the three-item constraint is meant to build).
- **R3** — yesterday's unfinished Kill List items resurface instead of
  vanishing at midnight (reuses the existing Qada backlog pattern; needs no
  schema change).
- **R4** — surface today's running Signal:Noise ratio live inside the Lock-In
  panel, not only after the fact.
- (R5 not separately titled in the source; treat the doc as authoritative if a
  fifth ranked item is needed.)

**Why "hours as the lever" was rejected:** every one of the four operators'
own *practiced* (not merely stated) behavior is subtraction-shaped — O'Leary's
three Post-its, Jobs's say-no filter, Hormozi's sleep floor, even Musk's own
Algorithm opening with "delete." The pro-hours claims in the research were the
least-verified and most-viral ones.

**Product consequence:** the app must never present accumulated hours as an
achievement. Focus time stays as context for output, never as a score.

**Explicitly not built on:** several popular claims were checked and found to
be folklore rather than the attributed source's own claim — Musk's "5-minute
blocking" (he publicly refuted it in 2018), Hormozi's "backward calendar
scheduling" (traces to one TikTok, not him), the maker/manager schedule (Paul
Graham, not Hormozi), "21 days to a habit" (a 1960 anecdote; real range is
18–254 days), the 70%/35% accountability statistic (never replicated).

---

## 2026-09-09 (approx.) — MCP connector session JWTs are signed with the legacy HS256 secret, not a new ES256 key

**Status:** Active
**Source:** `docs/ai-connector/OPERATOR-ACTIONS-PENDING.md`

**Context:** the original plan was to import a new ES256 public key into
Supabase for verifying MCP session JWTs.

**Decision:** that path was abandoned — the Supabase dashboard only offers
"Create Standby Key," never import, so it was never possible. Instead,
`lib/mcp/session.ts` signs with the project's legacy HS256 shared secret
(`SUPABASE_LEGACY_JWT_SECRET`), verified to work with PostgREST and RLS before
anything was built on it.

**Do not undo without understanding:** Supabase labels that key
"revoke once all tokens have expired." Revoking it breaks the MCP connector
with no fallback — see `.brain/memory/known-issues.md`.
