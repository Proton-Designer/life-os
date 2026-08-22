-- Fitness system rebuild, Phase 1 (Engineer A) — Cycle Progress checks.
-- 4-week cycles anchored once (defaults to first plan activation, spec's
-- logic-gap resolution #6) and benchmarked at each boundary. Weight/waist
-- are NOT duplicated here — body_metrics (027) already holds them with
-- `unique (user_id, date)`; this table only stores max-effort rep tests,
-- one row per (user, date, exercise), so a single benchmark session
-- logging both pull-ups and push-ups is two rows, not one wide row that
-- would need a new column per exercise the user happens to test.

create table public.fitness_cycle_anchor (
  user_id uuid primary key references auth.users(id) on delete cascade,
  anchor_date date not null,
  created_at timestamptz not null default now()
);

alter table public.fitness_cycle_anchor enable row level security;

create policy "fitness_cycle_anchor_own_row"
  on public.fitness_cycle_anchor for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table public.fitness_benchmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  exercise_id uuid references public.exercises(id),
  max_reps int not null check (max_reps >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, date, exercise_id)
);

create index fitness_benchmarks_user_id_idx on public.fitness_benchmarks (user_id);
create index fitness_benchmarks_user_date_idx on public.fitness_benchmarks (user_id, date);

alter table public.fitness_benchmarks enable row level security;

create policy "fitness_benchmarks_own_row"
  on public.fitness_benchmarks for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
