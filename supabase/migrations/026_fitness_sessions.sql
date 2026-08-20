-- Phase 1 (continued) — immutable logged-session snapshots (spec §2, §4:
-- "editing must never rewrite history"). workout_sessions/session_sets are
-- the confirm-writes-a-copy target: exercise_name is a text snapshot on
-- session_sets so a session stays readable even if its exercise is later
-- archived or renamed, and exercise_id is nullable with ON DELETE SET NULL
-- for the same reason (the FK is for joins when it's still useful, not a
-- requirement for the row to remain meaningful).
--
-- No idempotency unique index here on workout_sessions deliberately —
-- Phase 4 (Engineer 2) owns the confirm action's idempotency design
-- (partial unique index + RPC treating conflict as success, the
-- 022_save_allocation_checkin_idempotent.sql pattern) and the natural key
-- for "two confirms is a no-op" is theirs to choose alongside the UI, not
-- mine to preempt here.

create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  workout_id uuid references public.workouts(id) on delete set null,
  workout_name text,
  source text not null check (source in ('confirmed', 'adhoc', 'quick')),
  created_at timestamptz not null default now()
);

create index workout_sessions_user_id_idx on public.workout_sessions (user_id);
create index workout_sessions_user_date_idx on public.workout_sessions (user_id, date);

alter table public.workout_sessions enable row level security;

create policy "workout_sessions_own_row"
  on public.workout_sessions for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table public.session_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exercise_id uuid references public.exercises(id) on delete set null,
  exercise_name text not null,
  position int not null,
  sets int not null check (sets > 0),
  reps int not null check (reps >= 0),
  load numeric check (load is null or load >= 0),
  created_at timestamptz not null default now(),
  unique (session_id, position)
);

create index session_sets_session_id_idx on public.session_sets (session_id);
create index session_sets_user_id_idx on public.session_sets (user_id);

alter table public.session_sets enable row level security;

create policy "session_sets_own_row"
  on public.session_sets for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
