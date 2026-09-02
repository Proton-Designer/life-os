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
| `118`+ | — | next free | — |

**Applied: `110`, `111`, `114`, `115`.** Still pending: `112` (ULM, file on disk, awaiting
their verification) and `113` (CollegeOS, not yet written).

**The ledger head is NOT a high-water mark.** `115` is the head while `112` and `113` are
absent. Read the ledger as a set, never as "everything below this is applied" — that
misreading is how `089` was asserted applied when it wasn't.

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
