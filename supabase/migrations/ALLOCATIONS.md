# Migration number allocations

**The LifeOS lead allocates every number (R5). Nobody self-assigns.**
This file is the register. Update it *when you allocate*, not when the file lands —
the point is to make a number unavailable the moment it is promised.

> **Why this file and not `102`'s header, as R32 asked:** `102` is already applied and its
> md5 is recorded in `migration_ledger`. `apply-migration.sh` compares that hash on every
> run and refuses a file that changed after it was applied — editing `102` now would trip
> that check forever and train someone to ignore it. **The integrity check is worth more
> than the convenience of one location.** Same intent, different file.

| # | Owner (dir PID) | Contents | Status |
|---|---|---|---|
| `111` | ULM Eng 1 (54590) | Unified review log, lapses fix, `request_retention`, `state_after`, R17 `learning_steps`, folded CollegeOS questions half | **APPLIED** (sha `1b27aa1e`) |
| `112` | ULM Eng 1 (54590) | R1 follow-up: Tier 2 backfill, `SET NOT NULL`s, `learning_steps` correction, `user_settings` ensure guard | allocated (R21) |
| `113` | CollegeOS / B1 | Night Plan `tasks` schema: `mit_rank`, `planned_date`, partial unique index `tasks_mit_rank_per_day_idx` | allocated |
| `114` | LifeOS Eng 2 (95858) | Additive: `user_domains.depth` (NOT NULL), `profiles.evening_close_time`, `deen_habits.cue_time` | **APPLIED** |
| `115` | LifeOS Eng 2 (95858) | R27 flatten: `user_domains.key` CHECK change + `personal_growth` row split | **APPLIED** (sha `0494e0f3`) |
| `116` | LifeOS Eng 2 (95858) | Generic reading-log table (date, units, optional source/title, `user_id`) — NOT a `quran_sessions` reuse: all 6 consumers of that table treat every row as a real Qur'an session | allocated |
| `117` | ULM lead (42335) | Per-lesson `relevance_floor` (`checked` / `not_checked`) — the deferred embedding arm. R43 killed the local embedder on security grounds (4 unfixable highs in decoder code fed by user uploads), so the floor records that it was NOT checked rather than silently reading as a pass | allocated |
| `118` | ULM Eng 1 (54590) | `submit_review`'s `user_settings` lazy upsert + a `pg_proc` guard. NOT in `112` — `112` is the two `SET NOT NULL`s, the `learning_steps` correction and the backfill-RPC drop, so `111`'s raise path stays open until this lands | allocated |
| `119` | LifeOS lead (51713) | `tasks.domain` DROP NOT NULL — CHECK retained for non-null values | **APPLIED** |
| `120` | LifeOS lead (51713) | `tasks.dump_source` — school/milestone/worry/note/capture. **APPLIED.** Its CHECK carries the Postgres-GENERATED name `tasks_dump_source_check` (declared inline on `add column`), deterministic but chosen by nobody — that is the name to use if it ever needs dropping or altering | **APPLIED** |
| `121` | ULM Eng 1 (54590) | `118` guard follow-up (moved from `120`) | allocated |
| `122` | LifeOS Eng 2 (95858) | `user_settings.weekday_baselines smallint[7]` (R58) — populated by A3's rhythm screen. Until set, the Day Won comparison is ABSENT, never a zero baseline | allocated |
| `123` | LifeOS lead (51713) | Polymorphic session→commitment binding (R30/B3): three nullable columns on `work_sessions`, composite FKs for the two targets that exist, at-most-one CHECK. **`<= 1`, not `= 1`** — most sessions serve no commitment | allocated |
| `124` | ULM lead (42335) | (sha `9e333499…`) Phase C additive tables: `lesson_promotions`, append-only `lesson_verdicts`, `adopted` status + suspend-trigger extension, `retired_at` single-writer trigger + its drift instrument, `(user_id,id)` unique on `user_domains` if missing, and the composite FK closing `work_sessions.promotion_id` (left FK-less by `123`) | allocated |
| `125` | — | **WITHDRAWN, number burned deliberately.** Was the `adopted` enum value. The ULM lead found the session queue never reads `lessons.status`, `archived` is the pipeline's own holding state, and `worker-stages.ts:392` would OVERWRITE `adopted` on a resumed job — so the status was never load-bearing. Adoption stays in the append-only verdict log. **Not reused:** a burned number is a visible decision; a recycled one silently makes two different files share an identity in anyone's notes | withdrawn |
| `126` | ULM lead (42335) | Card suspension (R64), now the WHOLE mechanism: `cards.suspended_at` via a trigger on **`lesson_verdicts`** (not on a status column), and `get_session_queue` excluding suspended cards. **Never ported from ULM.** Touches the daily session's hot path — re-run `stranger-journey` after it deploys, **on `seed-domains` with a real deck and a promoted lesson, not on legacy SEED**. Latent only: today nothing archives a lesson that has cards |  allocated |
| `127` | ULM lead (42335) | **R69.** `111` left `card_states.card_id` NOT NULL while adding `card_states_item_xor` (`num_nonnulls(card_id, question_id) = 1`) — so a question-backed row is UNREPRESENTABLE and the unified scheduler is structurally empty for questions. Drop the NOT NULL **and** rewrite `card_states_book_id_matches_card`, which pins `book_id` NOT NULL by implication and undoes `111`'s own drop three lines above it. Red-first is a POSITIVE control: the question-backed insert fails today, succeeds after, and both rejections stay named. Verifier: CollegeOS Eng 1 | allocated |
| `128` | ULM lead (42335) | `reject_verdict_on_retired_promotion` — a verdict cannot be written against a retired promotion. Ledger md5 `845bf716…`, live `pg_proc` entry confirmed present, not just a ledger row | **APPLIED** |
| `129` | LifeOS lead (51713) | (sha `8fdc0521…`) **Deleting an active workout plan was impossible in production for weeks.** `100`'s composite tenancy FK carried an unqualified `on delete set null`, which nulls *every* column of the referencing key — including the NOT NULL `user_id` — so the delete always raised. Scopes it to `on delete set null (micro_plan_id)` (PG 15+; server is 17.6). **Do not relax the not-null instead:** a slot row owned by nobody is invisible to every RLS policy and accumulates unreachable. Red proved before, green after, and the cross-tenant rejection re-proved intact | **APPLIED** |
| `130` | LifeOS lead (51713) | AI-connector L2: `mcp_access_tokens` (sha256-hashed PATs, `scopes text[]` constrained to a non-empty subset of read/write, four own-row policies) + append-only `mcp_audit_log` (**select-only** RLS — an audit log its subject can edit is not one). Author: LifeOS Eng 1. **Held at review:** the non-empty scopes CHECK used `array_length(scopes,1) > 0`, which is NULL for an empty array, and a CHECK passes on NULL — so `'{}'` was accepted. Proven in a real table, fixed to `cardinality(scopes) > 0` | in review |
| `131` | LifeOS Eng 1 (L3) | `mcp_audit_log` resolved-operation column. Under the adopted 7-tool design every call would log `tool_name = 'read'`/`'write'`, which guts the audit log — its job is showing what a possibly-injected model actually DID, and "write x 400" says nothing. Records `deen.prayer.log` as its own column, not buried in `args` jsonb, so L6 can group/filter | allocated |
| `132` | LifeOS Eng 2 (L4) | OAuth 2.1 authorization server: `mcp_oauth_clients`, `mcp_oauth_codes`, `mcp_oauth_refresh_tokens`. Draft staged at `docs/ai-connector/L4-migration-draft-mcp-oauth.sql` — Eng 2 correctly did NOT self-assign a number. Codes are single-use via `UPDATE ... WHERE used_at IS NULL` (atomic CAS, not check-then-write), PKCE S256 mandatory, refresh rotation with reuse detection | allocated |
| `133` | LifeOS Eng 1 | (sha `c361b442…`) **Rescoped 8 tables -> 5 after review.** `updated_at` + migration 074's existing `touch_updated_at()` trigger across Deen's 8 tables. Exists because Eng 1 checked rather than assumed: TOOL-ARCHITECTURE.md's hard rule is "`updated_at` on every entity at every detail level", and a grep of the whole schema found a trigger-maintained `updated_at` on **exactly one of 68 tables** (`ingestion_jobs`, migration 074). The rule had no schema behind it. Arrived numbered `132`, colliding with the applied OAuth migration — renumbered by the lead. Eng 1 then read every Deen table's real write paths: `quran_sessions`/`reflection_entries` are genuinely append-only (insert/delete only, never updated in place), so `created_at` IS their true last-modified time and they get **no column**. Only the 5 genuinely-mutated tables get the trigger. Verified both directions: the 5 triggers bump on UPDATE, and the 3 others have no `updated_at` afterwards — proving it didn't touch what it shouldn't, not merely that it didn't error | **APPLIED** |
| `134` | LifeOS Eng 2 (L10) | `profiles.theme_preset` (5 presets, CHECKed) + `profiles.hidden_features text[]`. The allowed set for `hidden_features` deliberately **excludes `home` and `settings`** — hiding either is a self-inflicted lockout, not a feature. Both columns carry defaults so existing rows need no backfill. Eng 2 correctly staged it as a draft rather than self-numbering | allocated |
| `135` | LifeOS lead (this session) | (sha `b22b3db0…`) `updated_at` + 074's `touch_updated_at()` on `coop_targets`, `coop_tasks`, `kill_list_items`, `weekly_goals`. Same discipline as 133 — scoped by reading real write paths, **not** blanket: `work_sessions` is excluded because `ended_at` is set exactly once by `endWorkSession` and never re-set, so it is already a faithful marker. Authored from Eng 1's proposed DDL; they correctly did not self-number | allocated |
| `136` | LifeOS lead (this session) | `updated_at` + 074's trigger on `tasks`, `classes`, `class_assessments`, `schedule_events`, `schedule_event_overrides`. **`schedule_event_cancellations` deliberately excluded** — its only write is an `ignoreDuplicates` upsert (a true no-op on conflict), so rows are never modified after insert and `created_at` is already faithful; a trigger there would never fire. Note `tasks` is the widest blast radius in this program (shared school/co_op, read by Home, the work pipeline, capture and school views) — the change is additive-only, no existing query/index/policy affected | allocated |
| `137` | LifeOS Eng 2 | `updated_at` + 074's trigger on `profiles`, `user_settings`, `distraction_triggers`, `trigger_action_plans`, `trigger_plan_outcomes` — the cross-cutting read domains. Fourth instance of the same gap (133/135/136 were Deen, work/business, school). Note `user_settings` has **no timestamp column at all** today, not even `created_at`. Verified against real write paths, not inferred | allocated |
| `138`+ | — | next free | — |

**`112`'s prerequisite: RUN 2026-09-02 04:44, result recorded below.**

```
npx tsx scripts/backfill-review-state-after.ts
→ backfill-review-state-after: 0 cards with a null state_after row. Nothing to do.

reviews total 0 · state_after IS NULL 0 · learning_steps_after IS NULL 0
```

A genuine no-op, and recorded as a RESULT rather than a prediction — those look
identical in a report and are not the same evidence. Note the script's own header
documents "28 reviews, 28 distinct cards"; production has zero. That header
describes a different database, the same way a `database.types.ts` generated
against scratch once described a `deen_habits.cue_time` production did not have.

**`112` HAS A PREREQUISITE OUTSIDE THE FILE.** `scripts/backfill-review-state-after.ts` must be RUN
before applying `112`, and its result recorded — including when it is a no-op. Do not skip it as
obviously unnecessary: "obviously nothing to do" is a prediction, and the only thing that makes it
a fact is running it. This night has already produced an append-only guarantee reported OFF from an
UPDATE that touched zero rows on an empty table.

**Applied: `110`, `111`, `114`, `115`.** Still pending: `112` (ULM, file on disk, awaiting
their verification) and `113` (CollegeOS, not yet written).

**The ledger head is NOT a high-water mark.** `115` is the head while `112` and `113` are
absent. Read the ledger as a set, never as "everything below this is applied" — that
misreading is how `089` was asserted applied when it wasn't.

## Operator actions on production

Actions taken by hand, outside a migration. Recorded here because they change
production state and a migration file will never mention them.

**2026-09-02 08:08 — item 7 (`60fd192e…`): manual cursor advance 101 → 202, Boss R80.**
Extraction stopped at 46% on the shim's run-budget cap ($5, exhausted at $4.97246;
the HTTP 402 refusal is recorded in `ingestion_job_stage_attempts` in the provider's
own words). 130 lesson candidates were already extracted against a target cap of 60,
so further extraction could not change which stages run. Remaining budget $10 for
merging → verifying_grounding → generating_cards.

**CHUNKS 102–202 WERE NEVER EXTRACTED. This job reaching `stage=done` is NOT full
extraction of this book** — the arithmetic says so independently of this note: highest
touched chunk is 100 of 201.

No telemetry row accompanies it. The intended one was refused by
`ingestion_job_stage_attempts_error_shape` and would also have broken
`..._finish_shape`: an attempts row is either in flight (`finished_at`, `succeeded`,
`error` all null) or finished (`error` only when `succeeded IS FALSE`). **There is no
legal shape for "not an attempt"**, and the alternative — `succeeded = false` — would
have fabricated a second failed attempt, turning a true `102 succeeded / 1 failed`
into `2 failed` with one fictional. Corrupting a real metric to carry prose is worse
than the prose being absent. A proper operator-actions slot is a Day-2 item.

## Rules

- **Numbers are allocated by the LifeOS lead only** (R5), and recorded here at the moment
  of allocation.
- **A file under verification or apply is FROZEN** (R32.1). Editing it mid-flight makes
  every prior verification describe a different artifact. Announce an edit with the new
  `sha256`, and record in each report the hash actually run.
- **Production applies go through `apply-migration.sh`** — never bare `psql`. Two
  migrations arrived invisible to the ledger that way in one night.
- **Do NOT put `begin;`/`commit;` in a migration file.** The runner owns the transaction
  (`--single-transaction` is the default) and REFUSES any file numbered above `110` that
  carries its own, because a file's `commit;` ends the runner's transaction early and
  anything appended below it later runs unprotected while looking covered. Three files hit
  this in one night (`111`, `114`, `115`); `111` failed twice on production because of it.
- **A types file is a claim about ONE specific database.** `database.types.ts` was once
  committed after being generated against *scratch*, which asserted a `deen_habits.cue_time`
  production did not have — so code reading that column type-checked and shipped, and the
  feature could never have worked live. Regenerating during an apply is what keeps the claim
  true; the runner does it automatically, and that diff belongs in the migration's commit.
- **`--dry-run` prints the object manifest and exits.** Anything else run against
  production *is* an apply (R32.2) — learned by demonstrating a gate on a real file and
  advancing production's state in the process.
