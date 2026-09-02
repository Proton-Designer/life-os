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
| `111` | ULM Eng 1 (54590) | Unified review log, lapses fix, `request_retention`, `state_after`, R17 `learning_steps`, folded CollegeOS questions half | **FAILED PARTIAL on production** — awaiting idempotent rewrite (R31) |
| `112` | ULM Eng 1 (54590) | R1 follow-up: Tier 2 backfill, `SET NOT NULL`s, `learning_steps` correction, `user_settings` ensure guard | allocated (R21) |
| `113` | CollegeOS / B1 | Night Plan `tasks` schema: `mit_rank`, `planned_date`, partial unique index `tasks_mit_rank_per_day_idx` | allocated |
| `114` | LifeOS Eng 2 (95858) | Additive: `user_domains.depth` (NOT NULL), `profiles.evening_close_time`, `deen_habits.cue_time` | allocated |
| `115` | LifeOS Eng 2 (95858) | R27 flatten: `user_domains.key` CHECK change + `personal_growth` row split | allocated |
| `116`+ | — | next free | — |

**Applied through `110`.** `111` is a failed partial: `questions` exists (0 rows, RLS, 3
indexes) and the `reviews` columns exist, but `reviews_item_xor`,
`reviews_question_id_fkey` and `reviews_book_id_matches_card` do not, and `111` is **not**
recorded in the ledger.

## Rules

- **Numbers are allocated by the LifeOS lead only** (R5), and recorded here at the moment
  of allocation.
- **A file under verification or apply is FROZEN** (R32.1). Editing it mid-flight makes
  every prior verification describe a different artifact. Announce an edit with the new
  `sha256`, and record in each report the hash actually run.
- **Production applies go through `apply-migration.sh`** — never bare `psql`. Two
  migrations arrived invisible to the ledger that way in one night.
- **`--dry-run` prints the object manifest and exits.** Anything else run against
  production *is* an apply (R32.2) — learned by demonstrating a gate on a real file and
  advancing production's state in the process.
