-- Phase 1 of docs/superpowers/plans/2026-08-20-fitness-redesign.md — the
-- exercise library and workout templates that make a scheduled day a real
-- structured object instead of a free-text string (spec §2, §4).
--
-- Numbered 025, not 024 as the plan's Phase 1 section literally says: 024
-- was already taken by upsert_session_hour_fn.sql (missed-Lock-In-hours
-- work, applied 2026-08-19 before this phase started). Sessions/rep-goals
-- shift to 026/027 accordingly. Phase 7's workout_logs drop was going to be
-- 028, but by the time Phase 1 landed 028_coop_targets_and_tasks.sql
-- existed too (a different engineer's concurrent, unrelated Co-op work in
-- this shared directory) — so Phase 7's drop migration is 029, not 028.
-- Flagged to the Lead and Engineer 2, not silently renumbered.
--
-- RLS convention confirmed by direct inspection of the live `workout_logs`
-- and `workout_schedule` policies (both `<table>_own_row`, single `for all`
-- policy, `user_id = (select auth.uid())` on both using and with_check) via
-- the session pooler (aws-0-us-east-2.pooler.supabase.com — the direct
-- db.*.supabase.co host is IPv6-only and unreachable from this sandbox).
-- Every new table below matches that exact shape, not the older
-- four-separate-policies shape sunnah_logs (017) used.
--
-- `default auth.uid()` on every user_id — required, not optional, per the
-- checkin_allocations (019) lesson: sunnah_logs (017) omitted it and
-- produced an Insert type that typechecked and failed at runtime on NOT
-- NULL.
--
-- Muscle-group values are constrained here with an array-containment CHECK
-- against the same fixed set lib/fitness/volume.ts's MuscleGroup type will
-- define (Phase 2) — defense in depth at the schema layer, same pattern as
-- checkin_allocations.domain's CHECK, not left to application code alone.

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  primary_muscles text[] not null default '{}'
    check (primary_muscles <@ array[
      'chest','back_lats','back_mid','front_delt','side_delt',
      'rear_delt','biceps','triceps','core'
    ]::text[]),
  secondary_muscles text[] not null default '{}'
    check (secondary_muscles <@ array[
      'chest','back_lats','back_mid','front_delt','side_delt',
      'rear_delt','biceps','triceps','core'
    ]::text[]),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- Partial unique index, not a table UNIQUE constraint: lower(name) is an
-- expression, and only active (non-archived) rows should collide — an
-- archived "Cable Row" must not block creating a fresh "Cable Row".
create unique index exercises_user_name_unique
  on public.exercises (user_id, lower(name))
  where not archived;

create index exercises_user_id_idx on public.exercises (user_id);

alter table public.exercises enable row level security;

create policy "exercises_own_row"
  on public.exercises for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index workouts_user_id_idx on public.workouts (user_id);

alter table public.workouts enable row level security;

create policy "workouts_own_row"
  on public.workouts for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- exercise_id has no ON DELETE clause (defaults to NO ACTION): exercises
-- are archived, never hard-deleted (project-wide convention, spec §4), so a
-- workout_exercises row referencing an archived exercise is the expected
-- steady state, not a dangling reference to guard against.
create table public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  position int not null,
  target_sets int not null check (target_sets between 1 and 20),
  target_reps_low int not null check (target_reps_low > 0),
  target_reps_high int not null check (target_reps_high >= target_reps_low),
  target_load numeric check (target_load is null or target_load >= 0),
  unique (workout_id, position)
);

create index workout_exercises_workout_id_idx on public.workout_exercises (workout_id);
create index workout_exercises_user_id_idx on public.workout_exercises (user_id);

alter table public.workout_exercises enable row level security;

create policy "workout_exercises_own_row"
  on public.workout_exercises for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Nullable, no default: existing workout_schedule rows keep their
-- free-text workout_name and keep working exactly as before (legacy rows,
-- per spec §2's "workout_name stays for legacy rows"). ON DELETE SET NULL
-- rather than CASCADE — losing the day-slot's workout link should not
-- delete the day-slot itself, and is defensive rather than reachable since
-- workouts are archived, not deleted, same reasoning as exercise_id above.
alter table public.workout_schedule
  add column workout_id uuid references public.workouts(id) on delete set null;
