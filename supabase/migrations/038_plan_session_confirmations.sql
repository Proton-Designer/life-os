-- Fitness system rebuild, Phase 1 (Engineer A) — links a confirmed
-- workout_sessions row back to the plan_session it fulfilled, so the
-- Daily Log and This Week modules can show a session as confirmed without
-- guessing from workout_name text matching. Mirrors the existing
-- workout_sessions_confirmed_unique idempotency pattern from 029: a
-- partial unique index excluding nulls, so a second confirm of the same
-- plan session on the same day is a no-op at the database layer, not just
-- in the action.

alter table public.workout_sessions
  add column plan_session_id uuid null references public.plan_sessions(id) on delete set null;

create unique index workout_sessions_plan_session_unique
  on public.workout_sessions (user_id, date, plan_session_id)
  where source = 'confirmed' and plan_session_id is not null;
