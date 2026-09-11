# `updated_at` needed for 5 fitness tables

**STATUS: APPLIED.** This proposal shipped as
`supabase/migrations/138_fitness_updated_at.sql` (confirmed live: all five
columns and all five `*_touch_updated_at` triggers present in the catalog,
not just in `lib/supabase/database.types.ts`). `lib/mcp/registry.ts`'s five
corresponding entries were flipped to `updatedAtColumn: "updated_at"` on
2026-09-11 — later than this migration itself, which is exactly the gap this
banner exists to prevent from recurring: for a stretch between 138 landing
and that flip, this doc, `registry.ts`, and `registry.test.ts` all
independently said "not yet" and cited each other, and none of the three
had asked the database. Kept below as the historical design rationale for
why these five tables (and no others) needed the column — not as an open
request.

~~**Not a numbered migration.** Per the standing instruction ("if a domain
needs updated_at columns, that's another migration — tell me and I'll
allocate, don't self-number"), this is a request + a reviewable SQL sketch,
not a file in `supabase/migrations/`.~~ *(historical — it became migration
138, above.)*

## Which tables, and why (verified against real write paths, not inferred)

| table | entity | mutated by | existing timestamp | faithful? |
|---|---|---|---|---|
| `exercises` | `fitness.exercise` | `archiveExerciseCore` (UPDATE `archived`) | `created_at` | No — goes stale on the first archive |
| `workouts` | `fitness.workout` | `renameWorkoutCore`/`archiveWorkoutCore` (UPDATE), `save_workout` RPC (031, UPDATE `name`) | `created_at` | No — any of the three edits leaves it stale |
| `workout_plans` | `fitness.workout_plan` | `savePlan` (UPDATE `name` when editing an existing plan) | `created_at` | No |
| `body_metrics` | `fitness.body_metric` | `logWeightCore`/`logWaistCore`/`logCycleBenchmark`'s combined call (all upsert on `(user_id,date)` conflict, preserving the sibling field) | `created_at` | No — a re-logged date genuinely UPDATEs in place |
| `fitness_benchmarks` | `fitness.fitness_benchmark` | `logBenchmarkRepsCore`/`logCycleBenchmark`'s reps loop (upsert on `(user_id,date,exercise_id)` conflict) | `created_at` | No — re-logging the same exercise/date UPDATEs `max_reps` in place |

All five now ship in `lib/mcp/registry.ts` with `updatedAtColumn: "updated_at"`,
trigger-backed via the DDL below — same posture every domain now has after its
own equivalent migration landed (133 for deen, 135 for work/business, 136 for
school).

## DDL that shipped (reuses migration 074's `touch_updated_at()`, same as 133/135/136)

```sql
alter table public.exercises         add column updated_at timestamptz not null default now();
alter table public.workouts          add column updated_at timestamptz not null default now();
alter table public.workout_plans     add column updated_at timestamptz not null default now();
alter table public.body_metrics      add column updated_at timestamptz not null default now();
alter table public.fitness_benchmarks add column updated_at timestamptz not null default now();

create trigger exercises_touch_updated_at          before update on public.exercises          for each row execute function public.touch_updated_at();
create trigger workouts_touch_updated_at           before update on public.workouts            for each row execute function public.touch_updated_at();
create trigger workout_plans_touch_updated_at      before update on public.workout_plans        for each row execute function public.touch_updated_at();
create trigger body_metrics_touch_updated_at       before update on public.body_metrics         for each row execute function public.touch_updated_at();
create trigger fitness_benchmarks_touch_updated_at before update on public.fitness_benchmarks   for each row execute function public.touch_updated_at();
```

Applied as migration 138. The 5 corresponding registry entries now read
`updatedAtColumn: "updated_at"`, with an `updatedAtVerification` note naming
the trigger by name — same mechanical follow-up as every prior domain's
equivalent migration, just later than it should have been (see the STATUS
banner above).

## Tables checked and found NOT to need this, with reasons that are NEW shapes for this program

Three earlier domains' "no migration needed" tables were all **append-only**
(never updated after insert). Fitness adds a SECOND shape entirely: tables
that are real `UPDATE`-capable in the schema sense but are, in practice,
**always rewritten via delete-then-reinsert**, never touched in place —
`workout_exercises`, `plan_sessions`, `plan_session_exercises`,
`plan_micro_exercises` (all four, `save_workout`/`savePlan`'s
delete-everything-then-insert-the-new-list pattern). None of the four has a
`created_at`/`updated_at` column at all (confirmed directly against
migrations 025/036), and none needs one added: a changed row under this
pattern IS a different row (a fresh `gen_random_uuid()`), so there is no
"went stale while the id stayed the same" failure mode a timestamp would
even need to guard against. `detail:"ids"`'s reuse-scan degrades gracefully
here too — an id the caller already has either still exists unchanged, or
doesn't exist at all (deleted and replaced), never silently stale.

- `workout_exercises`, `plan_sessions`, `plan_session_exercises`,
  `plan_micro_exercises` — delete-then-reinsert shaped, as above. No
  migration requested.
- `workout_schedule` — also has no timestamp column at all (baseline +
  023's schema), but for a different reason than the four above: it's
  read-only via MCP this pass (see FITNESS-WRITE-SCOPE-DECISIONS.md), and
  it already churns via `lib/fitness/sync-workout-schedule.ts`'s own
  delete-then-reinsert shim whenever a routine plan is active. Not
  requested — low value for a table MCP never writes and that already
  self-invalidates this way.
- `workout_sessions`, `session_sets` — genuinely append-only (no
  update/delete path anywhere), already correctly `updatedAtColumn:
  "created_at"`.
- `fitness_cycle_anchor`, `rep_goals`, `active_workout_plans` — see each
  entity's own `updatedAtVerification` in registry.ts (no write path at
  all, zero writers confirmed via grep, and an already-real/faithful
  app-set `updated_at` respectively).
