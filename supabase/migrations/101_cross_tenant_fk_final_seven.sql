-- Close the last seven single-column FKs to user-scoped parents in LifeOS.
-- After this, LifeOS owns ZERO of them — which is the point: it turns a
-- judgement call made per-pair into a flat invariant a script can check.
--
-- WHY FINISH THE INTEGRITY-GAP-ONLY ONES (2026-09-01)
--
-- None of these seven is exploitable. I verified rather than assumed:
-- EVERY unique index on all six tables includes `user_id`, so there is no
-- non-user-scoped slot for an attacker to squat. ULM's engineer reached the
-- same verdict independently on the same pairs.
--
-- Fixing them anyway for one reason: 100 just closed nine integrity-gap-only
-- pairs. Leaving seven more of the identical class open would make "which gaps
-- are closed" a per-pair judgement again — and per-pair judgement is exactly
-- what failed here. 058's footer confidently mislabelled `exercises` and
-- `workouts` as shared catalogues when both are `user_id NOT NULL`, and that
-- one false sentence hid nine gaps behind a reason that read as considered.
--
-- A flat rule ("no single-column FK to a user-scoped parent") is checkable by
-- a script. A per-pair rule ("...except where we decided it was fine") is
-- checkable only by whoever remembers, and their memory is the thing that was
-- already wrong. scripts/preflight.sh now enforces the flat version.
--
-- PREFLIGHT AGAINST PRODUCTION: all 7 cross-tenant counts returned 0.
--
-- SIX OF THE SEVEN ARE NULLABLE. Postgres FKs are MATCH SIMPLE, so a row with
-- a NULL reference is not checked at all — existing unlinked rows are
-- untouched. `deen_weekly_focus.habit_id` is the sole NOT NULL / CASCADE one.
--
-- DELETE SEMANTICS READ PER-CONSTRAINT from pg_constraint: six are
-- ON DELETE SET NULL, one is ON DELETE CASCADE. Applying either uniformly
-- would silently change behaviour — 059 records the near-miss where exactly
-- that guess would have destroyed schedule events on class deletion.

-- Composite-FK targets. reflection_entries, work_sessions and tasks are the
-- three parents that don't have one yet; the rest were created by 058/100.
create unique index if not exists reflection_entries_user_id_id_key on public.reflection_entries (user_id, id);
create unique index if not exists work_sessions_user_id_id_key      on public.work_sessions (user_id, id);
create unique index if not exists tasks_user_id_id_key              on public.tasks (user_id, id);

-- ON DELETE SET NULL (six)
alter table public.active_workout_plans drop constraint if exists active_workout_plans_micro_plan_id_fkey;
alter table public.active_workout_plans add constraint active_workout_plans_micro_plan_same_user
  foreign key (user_id, micro_plan_id) references public.workout_plans (user_id, id) on delete set null;

alter table public.active_workout_plans drop constraint if exists active_workout_plans_routine_plan_id_fkey;
alter table public.active_workout_plans add constraint active_workout_plans_routine_plan_same_user
  foreign key (user_id, routine_plan_id) references public.workout_plans (user_id, id) on delete set null;

alter table public.checkins drop constraint if exists checkins_work_session_id_fkey;
alter table public.checkins add constraint checkins_work_session_same_user
  foreign key (user_id, work_session_id) references public.work_sessions (user_id, id) on delete set null;

-- The pair 058 deferred "so this migration stays one shape". No longer deferred.
alter table public.class_assessments drop constraint if exists class_assessments_task_id_fkey;
alter table public.class_assessments add constraint class_assessments_task_same_user
  foreign key (user_id, task_id) references public.tasks (user_id, id) on delete set null;

alter table public.distraction_events drop constraint if exists distraction_events_reflection_entry_id_fkey;
alter table public.distraction_events add constraint distraction_events_reflection_same_user
  foreign key (user_id, reflection_entry_id) references public.reflection_entries (user_id, id) on delete set null;

alter table public.workout_sessions drop constraint if exists workout_sessions_plan_session_id_fkey;
alter table public.workout_sessions add constraint workout_sessions_plan_session_same_user
  foreign key (user_id, plan_session_id) references public.plan_sessions (user_id, id) on delete set null;

-- ON DELETE CASCADE (one)
alter table public.deen_weekly_focus drop constraint if exists deen_weekly_focus_habit_id_fkey;
alter table public.deen_weekly_focus add constraint deen_weekly_focus_habit_same_user
  foreign key (user_id, habit_id) references public.deen_habits (user_id, id) on delete cascade;
