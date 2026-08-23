-- Fitness system rebuild, Phase 1 (Engineer A / jazdm6pt) —
-- docs/superpowers/plans/2026-08-22-fitness-system.md.
--
-- Plans become first-class: a `workout_plans` row is either a `micro`
-- (loose exercises, no sessions) or a `routine` (named sessions, each with
-- its own schedule). This replaces the old model where the starter plan
-- lived only in `rep_goals` and a session plan only existed as loose
-- `workouts` rows glued together via `workout_schedule` — neither could
-- answer "which plan am I on."
--
-- RLS convention matches 025/027 exactly: single `<table>_own_row` policy
-- `for all`, `user_id = (select auth.uid())` on both using/with_check,
-- `default auth.uid()` on every user_id column.
--
-- `schedule_days` is `int[]` of 0=Sun..6=Sat, the same convention
-- `rep_goals.active_days` already uses (027). Presets (everyday / weekdays
-- / weekends / M-W / T-Th / custom) are a UI-only concept that expands to
-- this array on save — the preset name itself is never stored, so there is
-- nothing to keep in sync if the UI's preset list changes later.

create table public.workout_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('micro', 'routine')),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- Partial unique index (not a table UNIQUE): lower(name) is an expression,
-- and only active plans should collide — an archived "Starter Reps" must
-- not block creating a fresh plan of the same name later.
create unique index workout_plans_user_name_unique
  on public.workout_plans (user_id, lower(name))
  where not archived;

create index workout_plans_user_id_idx on public.workout_plans (user_id);

alter table public.workout_plans enable row level security;

create policy "workout_plans_own_row"
  on public.workout_plans for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- A micro plan's loose exercises — each one independently scheduled and
-- independently goaled (daily_total vs frequency), spec's Micro fork.
create table public.plan_micro_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id uuid not null references public.workout_plans(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  position int not null,
  schedule_days int[] not null default '{1,2,3,4,5}'
    check (schedule_days <@ array[0,1,2,3,4,5,6]::int[]),
  goal_type text not null check (goal_type in ('daily_total', 'frequency')),
  goal_value int not null check (goal_value > 0),
  notes text,
  unique (plan_id, position)
);

create index plan_micro_exercises_plan_id_idx on public.plan_micro_exercises (plan_id);
create index plan_micro_exercises_user_id_idx on public.plan_micro_exercises (user_id);

alter table public.plan_micro_exercises enable row level security;

create policy "plan_micro_exercises_own_row"
  on public.plan_micro_exercises for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- A routine plan's named sessions. `start_time` is nullable — spec's
-- ruling: with a time it renders at that hour, without one it's an
-- "unscheduled" band at the top of the day.
create table public.plan_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id uuid not null references public.workout_plans(id) on delete cascade,
  name text not null,
  position int not null,
  schedule_days int[] not null default '{1,2,3,4,5}'
    check (schedule_days <@ array[0,1,2,3,4,5,6]::int[]),
  start_time time null,
  unique (plan_id, position)
);

create index plan_sessions_plan_id_idx on public.plan_sessions (plan_id);
create index plan_sessions_user_id_idx on public.plan_sessions (user_id);

alter table public.plan_sessions enable row level security;

create policy "plan_sessions_own_row"
  on public.plan_sessions for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- A session's specific exercises. duration_minutes is required (it drives
-- workout_schedule's re-synced duration_minutes, and the hourly calendar
-- preview) — weight/sets/reps are optional per spec.
create table public.plan_session_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null references public.plan_sessions(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  position int not null,
  duration_minutes int not null check (duration_minutes > 0),
  load_lb numeric check (load_lb is null or load_lb >= 0),
  target_sets int check (target_sets is null or target_sets between 1 and 20),
  target_reps int check (target_reps is null or target_reps > 0),
  unique (session_id, position)
);

create index plan_session_exercises_session_id_idx on public.plan_session_exercises (session_id);
create index plan_session_exercises_user_id_idx on public.plan_session_exercises (user_id);

alter table public.plan_session_exercises enable row level security;

create policy "plan_session_exercises_own_row"
  on public.plan_session_exercises for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Data migration, part 1 (idempotent): existing `rep_goals` rows become a
-- "Starter Reps" micro plan. Activation into the micro slot happens in
-- 037_active_workout_plans.sql, once that table exists — this migration
-- only creates the plan + its exercise rows. Guarded by a NOT EXISTS check
-- on the plan name so re-running this file (or a fresh deploy replaying
-- migrations) never duplicates it. `rep_goals` rows themselves are left in
-- place, untouched — nothing reads them going forward once Phase 1's
-- readers are repointed, but dropping the table is out of scope here.
do $$
declare
  u record;
  g record;
  v_plan_id uuid;
  v_position int;
  v_earliest_created timestamptz;
begin
  for u in
    select distinct user_id from public.rep_goals where not archived
  loop
    select id into v_plan_id
      from public.workout_plans
      where user_id = u.user_id and lower(name) = lower('Starter Reps') and not archived;

    if v_plan_id is null then
      -- created_at is backdated to the original rep_goals row's creation
      -- time, not `now()` (2026-08-22 review catch, the Lead): This
      -- Week's per-day status floors "Missed" at a plan's own created_at,
      -- so a migration-time created_at would make every day before the
      -- migration ran look like the plan never existed there either —
      -- wrong in the opposite direction, hiding real missed days rather
      -- than fabricating them. The starter plan's true origin is when the
      -- user first set the rep goals, which this migration is preserving,
      -- not replacing.
      select min(created_at) into v_earliest_created
        from public.rep_goals
        where user_id = u.user_id and not archived;

      insert into public.workout_plans (user_id, name, kind, created_at)
      values (u.user_id, 'Starter Reps', 'micro', coalesce(v_earliest_created, now()))
      returning id into v_plan_id;

      v_position := 0;
      for g in
        select exercise_id, daily_target, active_days
          from public.rep_goals
          where user_id = u.user_id and not archived
          order by created_at
      loop
        v_position := v_position + 1;
        insert into public.plan_micro_exercises (
          user_id, plan_id, exercise_id, position, schedule_days, goal_type, goal_value
        )
        values (
          u.user_id, v_plan_id, g.exercise_id, v_position, g.active_days, 'daily_total', g.daily_target
        );
      end loop;
    end if;
  end loop;
end $$;
