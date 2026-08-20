-- Phase 1 (continued) — the daily-rep-goal object powering the starter
-- plan (spec §5: "orthogonal to the day-picker and the workout library ...
-- do not force one day-slot to hold two content types") and the paired
-- weight/waist body-metrics module (spec §6).
--
-- rep_goals.exercise_id has no ON DELETE clause (NO ACTION), same
-- reasoning as workout_exercises.exercise_id in 025 — exercises are
-- archived, never hard-deleted, so this is not a reachable dangling
-- reference to guard against.
--
-- active_days is constrained to 0-6 (0=Sun) by array containment, same
-- technique as exercises' muscle-group CHECKs in 025.

create table public.rep_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  daily_target int not null check (daily_target > 0),
  active_days int[] not null default '{1,2,3,4,5}'
    check (active_days <@ array[0,1,2,3,4,5,6]),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- Partial unique index: an archived goal for an exercise must not block
-- creating a fresh active one for the same exercise (same pattern as
-- exercises_user_name_unique in 025).
create unique index rep_goals_user_exercise_unique
  on public.rep_goals (user_id, exercise_id)
  where not archived;

create index rep_goals_user_id_idx on public.rep_goals (user_id);

alter table public.rep_goals enable row level security;

create policy "rep_goals_own_row"
  on public.rep_goals for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- The CHECK enforces spec §6's pairing at the data layer: a row with
-- neither number is meaningless and the module renders both lines from one
-- table by design, not two independently-nullable metrics that happen to
-- be displayed together.
create table public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  weight_lb numeric check (weight_lb is null or weight_lb > 0),
  waist_in numeric check (waist_in is null or waist_in > 0),
  created_at timestamptz not null default now(),
  unique (user_id, date),
  check (weight_lb is not null or waist_in is not null)
);

create index body_metrics_user_id_idx on public.body_metrics (user_id);
create index body_metrics_user_date_idx on public.body_metrics (user_id, date);

alter table public.body_metrics enable row level security;

create policy "body_metrics_own_row"
  on public.body_metrics for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
