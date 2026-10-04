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

---

## 2026-10-04 — Deen Mode is one boolean on `profiles`, default OFF, gate-only

**Status:** Active
**Source:** `.claude/overnight/run-20261004-1135/INSTRUCTIONS.md` (D1–D7), migration 251

**Decision:** religious surfaces are controlled by `profiles.deen_mode` (not an `enabled_features` entry, not a `user_domains` row). New accounts are OFF; OFF hides, never deletes (R4); onboarding offers no faith option. In Settings it supersedes the `hidden_features` "deen" entry, and `deen_mode` is intentionally not MCP-writable.

**Do not undo without understanding:** `enabled_features` has a DB CHECK tied to a TS enum, and a user wanted the switch in the Features panel; making it a domain row would let onboarding re-introduce faith.

## 2026-10-04 — Deen Mode: decisions behind the build (run 20261004-1135)

**Status:** Active
**Source:** `.claude/overnight/run-20261004-1135/INSTRUCTIONS.md` §2 (D1–D7, A1–A3), `LOG.md`

- **Single column, not `enabled_features`:** see the entry above.
- **OFF = gate, never delete (R4):** every OFF path skips the query or refuses the write; no row is changed. Gates are *required* parameters so a forgotten caller fails `tsc`, and Server Actions refuse server-side (they are public endpoints).
- **AI connector blocked when OFF (A2):** the `deen` domain is hidden and deen reads/writes refused (`ToolInputError`), including deen-flavoured rows inside non-deen entities (triggers, allocations, events, action plans/outcomes, widgets, schedules). `deen_mode` is never AI-writable.
- **Goals tagged `deen` are hidden when OFF** (they are religious content); data kept.
- **Optimistic tap pattern (PERF-1/2/3):** per-item local state via `lib/client/use-optimistic-item` (+ `use-optimistic-toggles` for lists) on `lib/client/keyed-queue` (writes for one key run in tap order; keys independent; nothing disabled while another saves; per-item rollback), writes are **absolute setters, never toggles**, hot-tap actions are lean (no inline `revalidatePath`), and ONE debounced data-free refresh Server Action (`refreshXViews`) re-syncs surfaces per burst. Why a Server Action and not `router.refresh()`: only `revalidatePath` purges the client Router Cache for other routes (Home).
- **Test plan (heat):** vitest runs `.ts` in node and `.tsx` in jsdom (e4e4be8; a `.ts` test needing DOM starts with `// @vitest-environment jsdom`). Per task: related tests while building, ONE `heavy.sh ./scripts/preflight.sh` before the author's commit, reviewers run `related` + tsc only, the lead runs a full preflight per deploy.

**Do not undo without understanding:** converting an absolute setter back to a toggle reintroduces the failure-then-queued-tap flip bug (PERF-1 review F1).

## One "+" capture: Task picks its area, Note → Inbox, one distraction logger (IA-P1a, 2026-10-04)

**Status:** Active (IA Option A, phase P1a)
**Source:** `audit/IA/IA-A-PLAN.md`, `lib/capture/areas.ts`, `lib/inbox/inbox-core.ts`

- **Task area is chosen, never hard-wired:** `captureTask({area})` — `school`/`co_op` → `addTaskCore` (`tasks.domain` CHECK admits only those); `none` = the **Inbox**. An unknown/missing area throws (no quiet default to School). The sheet's chip row comes from `buildCaptureAreaConfig(navMode, navDomainState)` (legacy = School + Work + Inbox; domains = only the areas turned on; a Work area needs a job tab). Default per route: `/school`→School, `/work`, `/work/<job tab>`→Work, `/work/<business tab>` and `/business`→No area (Business has no task home — never guessed), elsewhere→No area.
- **Inbox = existing rows, no migration:** `tasks` with `domain IS NULL`, `dump_source='capture'`, `completed=false` (a Note, or a "No area" Task which also keeps its parsed due date/time). The evening close PLAN stage shows them above the dump with one-tap triage (`triageInboxItem` → `triageInboxCore`): Plan tonight (→ `dump_source='note'` + the ceremony's planned date, server-derived), Task in <area> (→ domain set, planned_date cleared), It's a worry (→ `dump_source='worry'`), Done (→ `completed=true`; nothing is ever deleted). Every update re-asserts the Inbox shape in its WHERE and errors when 0 rows change, so a stale tap can't touch an already-triaged row. Only `/close` (tonight) shows the Inbox, not `/close/replan`.
- **One distraction logger:** the "+" sheet's Distraction segment opens the topbar `DistractionCaptureDialog` (controlled `open`/`onOpenChange`/`hideTrigger`) instead of its own text form. The standalone `/capture` page (no app shell/Lock-In provider) keeps the old text form via `captureDistraction`, which ends in the same `createTriggerAndLog`.

**Do not undo without understanding:** moving a triaged Inbox row without leaving the `domain null + dump_source capture` shape makes it reappear in the Inbox every night.
