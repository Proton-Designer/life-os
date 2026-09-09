-- 138: `updated_at` for the five fitness tables with genuine update-in-place paths.
--
-- Fifth and final instance of the gap (133 Deen, 135 work/business, 136 school,
-- 137 cross-cutting). Same rule, same reason: TOOL-ARCHITECTURE.md requires
-- `updated_at` on every entity at every detail level, because `read(detail:"ids")`
-- is the mechanism behind the owner's "reuse information it probably already
-- has" requirement, and a row that changed while reporting an unchanged marker
-- is silently wrong.
--
-- SCOPED BY READING WRITE PATHS -- and fitness produced a THIRD category that
-- none of the previous four migrations had to reason about. Ten of fitness's
-- fifteen tables are deliberately excluded, for three distinct reasons:
--
--   1. APPEND-ONLY. `workout_sessions`, `session_sets` -- confirmed zero update
--      or delete path anywhere in the app, matching the spec's own rule that
--      "editing must never rewrite history". `created_at` IS their faithful
--      last-modified time. A trigger here would never fire.
--
--   2. DELETE-THEN-REINSERT, never updated in place. `workout_exercises`,
--      `plan_sessions`, `plan_session_exercises`, `plan_micro_exercises` are
--      always rewritten wholesale rather than mutated. **A changed row is a
--      different row**, with a different id -- so an `updated_at` would not
--      merely be redundant, it would be meaningless: the marker a caller cached
--      belongs to a row that no longer exists. This category did not exist in
--      the previous four passes and is the reason "no migration needed" here is
--      a finding rather than a deferral.
--
--   3. NO WRITE PATH AT ALL. `fitness_cycle_anchor` is never written by any code
--      in this application -- migration 039's stated "defaults to first plan
--      activation" was apparently never implemented. Registered read-only and
--      flagged separately; a column on a table nothing writes is not a fix.
--
-- The five below are the genuine remainder: real update-in-place paths, and no
-- existing column that survives a non-completion edit.
--
-- Reuses 074's `touch_updated_at()`.

alter table public.exercises          add column if not exists updated_at timestamptz not null default now();
alter table public.workouts           add column if not exists updated_at timestamptz not null default now();
alter table public.workout_plans      add column if not exists updated_at timestamptz not null default now();
alter table public.body_metrics       add column if not exists updated_at timestamptz not null default now();
alter table public.fitness_benchmarks add column if not exists updated_at timestamptz not null default now();

drop trigger if exists exercises_touch_updated_at on public.exercises;
create trigger exercises_touch_updated_at
  before update on public.exercises for each row execute function public.touch_updated_at();

drop trigger if exists workouts_touch_updated_at on public.workouts;
create trigger workouts_touch_updated_at
  before update on public.workouts for each row execute function public.touch_updated_at();

drop trigger if exists workout_plans_touch_updated_at on public.workout_plans;
create trigger workout_plans_touch_updated_at
  before update on public.workout_plans for each row execute function public.touch_updated_at();

drop trigger if exists body_metrics_touch_updated_at on public.body_metrics;
create trigger body_metrics_touch_updated_at
  before update on public.body_metrics for each row execute function public.touch_updated_at();

drop trigger if exists fitness_benchmarks_touch_updated_at on public.fitness_benchmarks;
create trigger fitness_benchmarks_touch_updated_at
  before update on public.fitness_benchmarks for each row execute function public.touch_updated_at();
