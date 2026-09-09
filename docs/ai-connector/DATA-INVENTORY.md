# Data inventory — what "read everything" actually means

Generated 2026-09-08 from production, not from the schema files.
This is the raw material for TOOL-ARCHITECTURE.md. **68 tables**, RLS enabled on
every one — one read tool per table is 68 tools and is not viable (see R8).

## Tables by domain grouping

| Table | cols | rows | note |
|---|---|---|---|
| `active_workout_plans` | 4 | ~2 | |
| `adhkar_logs` | 5 | ~0 | |
| `body_metrics` | 6 | ~0 | |
| `book_sections` | 8 | ~0 | |
| `books` | 17 | ~10 | |
| `card_states` | 14 | ~329 | |
| `cards` | 10 | ~570 | |
| `checkin_allocations` | 7 | ~0 | |
| `checkins` | 12 | ~1 | |
| `class_assessments` | 12 | ~18 | |
| `classes` | 12 | ~16 | |
| `coop_targets` | 8 | ~4 | |
| `coop_tasks` | 9 | ~9 | |
| `custom_habits` | 6 | ~0 | |
| `deen_habit_logs` | 5 | ~12 | |
| `deen_habits` | 10 | ~61 | |
| `deen_weekly_focus` | 5 | ~3 | |
| `distraction_events` | 7 | ~4 | |
| `distraction_triggers` | 7 | ~6 | |
| `exercises` | 7 | ~4 | |
| `fitness_benchmarks` | 6 | ~0 | |
| `fitness_cycle_anchor` | 3 | ~2 | |
| `habit_logs` | 5 | ~0 | |
| `ingestion_job_stage_attempts` | 13 | ~228 | |
| `ingestion_jobs` | 12 | ~1 | |
| `kill_list_items` | 8 | ~8 | |
| `lesson_promotions` | 11 | ~2 | |
| `lesson_verdicts` | 6 | ~2 | |
| `lessons` | 18 | ~216 | |
| `migration_115_orphaned_group_weight_log` | 7 | ~0 | |
| `migration_ledger` | 5 | ~104 | |
| `notification_log` | 6 | ~73 | |
| `notification_reads` | 5 | ~0 | |
| `pending_storage_deletions` | 7 | ~0 | |
| `plan_micro_exercises` | 9 | ~2 | |
| `plan_session_exercises` | 9 | ~0 | |
| `plan_sessions` | 8 | ~0 | |
| `prayers` | 6 | ~68 | |
| `profiles` | 20 | ~13 | |
| `push_subscriptions` | 6 | ~1 | |
| `questions` | 12 | ~0 | |
| `quran_sessions` | 7 | ~0 | |
| `reflection_entries` | 5 | ~2 | |
| `rep_goals` | 7 | ~2 | |
| `reviews` | 23 | ~17 | |
| `schedule_event_cancellations` | 5 | ~0 | |
| `schedule_event_overrides` | 7 | ~0 | |
| `schedule_events` | 15 | ~22 | |
| `self_explanations` | 7 | ~0 | |
| `session_sets` | 10 | ~1 | |
| `source_chunks` | 10 | ~286 | |
| `sources` | 5 | ~10 | |
| `sunnah_logs` | 7 | ~6 | |
| `tasks` | 15 | ~128 | |
| `trigger_action_plans` | 8 | ~2 | |
| `trigger_plan_outcomes` | 7 | ~4 | |
| `user_api_keys` | 7 | ~0 | |
| `user_domains` | 9 | ~22 | |
| `user_settings` | 8 | ~8 | |
| `user_stats` | 10 | ~7 | |
| `user_subdomains` | 12 | ~30 | |
| `weekly_goals` | 9 | ~5 | |
| `work_sessions` | 13 | ~411 | |
| `workout_exercises` | 9 | ~0 | |
| `workout_plans` | 6 | ~1 | |
| `workout_schedule` | 7 | ~0 | |
| `workout_sessions` | 8 | ~1 | |
| `workouts` | 5 | ~41 | |

## Findings that change the plan

### The book pipeline is largely built. L9 is much smaller than I sized it.

`lib/self-mastery/ingestion-availability.ts` reads as though ingestion does not exist. The
database says otherwise:

| table | rows | meaning |
|---|---|---|
| `books` | 10 | real books, with `status`/`stage`/`progress_pct`/`page_count`/`lesson_count` |
| `sources` | 10 | one per book |
| `source_chunks` | **286** | **chunked text already exists** — `text`, `page_start/end`, `token_count`, `embedding` |
| `ingestion_jobs` | 1 | the claim/lease machinery has run |
| `book_sections` | **0** | **empty** |

So **PDF → chunks with embeddings already works and has produced real data.** What the
owner asked for in R6 — "a summary of each section/chapter of the book/pdf should be
created, and send those to the AI through MCP" — needs two things that genuinely do not
exist:

1. **`book_sections` is never populated.** Chapter structure is not being extracted.
2. **There is nowhere to put a summary.** `book_sections` is `(id, book_id, user_id, title,
   sort_order, page_start, page_end, level)` — a table-of-contents shape with **no summary
   column**. R6 needs one, plus provenance (which chunks fed it, which model, when).

L9 is therefore: populate section structure, add summary storage, run chunks→summaries
through DeepSeek in batches, expose summaries over MCP. The expensive half — extraction,
chunking, embeddings, the job/lease machinery — is already there and working.

### Everything is RLS-protected, which the auth bridge depends on

All 68 tables have `rowsecurity = true`. Two carry no policies at all
(`migration_ledger`, `migration_115_orphaned_group_weight_log`) — RLS on with no policy
is deny-all to users, which is correct for operational tables and means they are
automatically invisible to MCP without us doing anything.

This is what makes R4's minted-JWT approach safe: we are not *adding* protection at the
tool layer, we are inheriting protection the database already enforces. A tool that forgets
to filter by user still cannot read another user's rows.

### Shape of the read surface, for TOOL-ARCHITECTURE.md

Rough grouping of the 68:

- **Deen** — `prayers`, `sunnah_logs`, `adhkar_logs`, `quran_sessions`, `deen_habits`,
  `deen_habit_logs`, `deen_weekly_focus`, `reflection_entries`
- **Work / Business** — `tasks`, `work_sessions`, `weekly_goals`, `kill_list_items`,
  `coop_targets`, `coop_tasks`
- **School** — `classes`, `class_assessments`, `schedule_events`,
  `schedule_event_overrides`, `schedule_event_cancellations`
- **Fitness** — `workout_plans`, `workouts`, `workout_sessions`, `workout_schedule`,
  `workout_exercises`, `plan_sessions`, `plan_session_exercises`, `plan_micro_exercises`,
  `exercises`, `session_sets`, `body_metrics`, `fitness_benchmarks`,
  `fitness_cycle_anchor`, `active_workout_plans`, `rep_goals`
- **Self-mastery / ULM** — `books`, `book_sections`, `sources`, `source_chunks`, `lessons`,
  `cards`, `card_states`, `reviews`, `questions`, `self_explanations`,
  `lesson_promotions`, `lesson_verdicts`, `ingestion_jobs`,
  `ingestion_job_stage_attempts`
- **Distractions** — `distraction_triggers`, `distraction_events`,
  `trigger_action_plans`, `trigger_plan_outcomes`
- **Check-ins** — `checkins`, `checkin_allocations`
- **Cross-cutting** — `profiles`, `user_settings`, `user_stats`, `user_domains`,
  `user_subdomains`, `custom_habits`, `habit_logs`, `notification_log`,
  `notification_reads`, `push_subscriptions`, `user_api_keys`
- **Operational, must NOT be exposed** — `migration_ledger`,
  `migration_115_orphaned_group_weight_log`, `pending_storage_deletions`

Note `user_api_keys` appears above: it is user-scoped and therefore readable under the
owner's "read everything including settings," but it stores an **encrypted DeepSeek key**.
Expose its *existence and last4* only — never `encrypted_key`. The existing
`getApiKeyStatuses()` already models the right shape.
