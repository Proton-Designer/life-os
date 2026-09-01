-- Make cross-tenant parent/child rows unrepresentable.
--
-- THE BUG, PROVEN NOT ARGUED (2026-09-01)
--
-- Every parent->child foreign key in this schema is single-column
-- (`child.parent_id -> parent(id)`). **Foreign-key checks run as the table
-- owner and bypass RLS.** So a row whose `user_id` is mine, pointing at a
-- parent owned by someone else, satisfies both the FK (the parent exists) and
-- the RLS `with check` (the user_id is mine). Nothing rejects it.
--
-- Demonstrated end to end against `save_trigger_plan`:
--
--   A knows B's trigger uuid (leaked, shared, or guessed). A cannot SEE it —
--   RLS works. But A calls save_trigger_plan(B_trigger_id, ...), which does no
--   existence check, and the insert succeeds:
--       CREATED: user_id=A  trigger_id=<B's trigger>
--       cross_tenant_rows = 1
--
-- And the consequence is worse than junk data, because
-- `trigger_action_plans_one_current` is UNIQUE on `(trigger_id) WHERE
-- superseded_at IS NULL` — **not scoped by user**. So after A squats:
--
--       A squatted the trigger
--       B LOCKED OUT: duplicate key value violates unique constraint
--                     "trigger_action_plans_one_current"
--
-- **B can no longer save an action plan on their own trigger, permanently**,
-- and cannot see or delete A's row because RLS hides it. That is a
-- cross-tenant denial of service reachable by anyone who learns a uuid.
--
-- Today the blast radius is small — effectively one real user. It stops being
-- small the moment this platform is genuinely multi-tenant, which is the
-- direction M2/M3 push it by construction.
--
-- THE FIX
--
-- Composite foreign keys: `(user_id, parent_id) -> parent(user_id, id)`. This
-- makes "a child whose parent belongs to someone else" **unrepresentable**
-- rather than merely unlikely — the same move as `num_nonnulls` and as the
-- generated `counts_toward_hours` column. It is enforced by the database, so
-- no future action, RPC or hand-written query has to remember it.
--
-- Migration 056 already used this pattern for user_domains/user_subdomains
-- after the same gap was found there in review. This applies it to the nine
-- pre-existing parent/child pairs that were never given it.
--
-- SAFE ON POPULATED TABLES: every FK below is *narrowed*, never widened. Any
-- row that satisfies the new composite key already satisfied the old one. If
-- live data contains a genuine cross-tenant row this migration will FAIL LOUDLY
-- at apply time rather than silently accept it — which is the correct outcome
-- and is why the preflight queries at the bottom of this file exist.

-- ---------------------------------------------------------------------------
-- 1. Parents need a unique index on (user_id, id) for the composite FK target.
--    `id` is already the primary key, so these are redundant for uniqueness —
--    they exist purely so a composite FK has something to reference.
-- ---------------------------------------------------------------------------
create unique index if not exists custom_habits_user_id_id_key       on public.custom_habits (user_id, id);
create unique index if not exists deen_habits_user_id_id_key         on public.deen_habits (user_id, id);
create unique index if not exists workout_sessions_user_id_id_key    on public.workout_sessions (user_id, id);
create unique index if not exists coop_targets_user_id_id_key        on public.coop_targets (user_id, id);
create unique index if not exists workout_plans_user_id_id_key       on public.workout_plans (user_id, id);
create unique index if not exists distraction_triggers_user_id_id_key on public.distraction_triggers (user_id, id);
create unique index if not exists trigger_action_plans_user_id_id_key on public.trigger_action_plans (user_id, id);
create unique index if not exists classes_user_id_id_key             on public.classes (user_id, id);

-- ---------------------------------------------------------------------------
-- 2. Replace each single-column FK with its composite equivalent.
--    ON DELETE CASCADE is preserved exactly as it was on each original.
-- ---------------------------------------------------------------------------

alter table public.habit_logs drop constraint if exists habit_logs_habit_id_fkey;
alter table public.habit_logs add constraint habit_logs_habit_same_user
  foreign key (user_id, habit_id) references public.custom_habits (user_id, id) on delete cascade;

alter table public.deen_habit_logs drop constraint if exists deen_habit_logs_habit_id_fkey;
alter table public.deen_habit_logs add constraint deen_habit_logs_habit_same_user
  foreign key (user_id, habit_id) references public.deen_habits (user_id, id) on delete cascade;

alter table public.session_sets drop constraint if exists session_sets_session_id_fkey;
alter table public.session_sets add constraint session_sets_session_same_user
  foreign key (user_id, session_id) references public.workout_sessions (user_id, id) on delete cascade;

alter table public.coop_tasks drop constraint if exists coop_tasks_target_id_fkey;
alter table public.coop_tasks add constraint coop_tasks_target_same_user
  foreign key (user_id, target_id) references public.coop_targets (user_id, id) on delete cascade;

alter table public.plan_sessions drop constraint if exists plan_sessions_plan_id_fkey;
alter table public.plan_sessions add constraint plan_sessions_plan_same_user
  foreign key (user_id, plan_id) references public.workout_plans (user_id, id) on delete cascade;

alter table public.distraction_events drop constraint if exists distraction_events_trigger_id_fkey;
alter table public.distraction_events add constraint distraction_events_trigger_same_user
  foreign key (user_id, trigger_id) references public.distraction_triggers (user_id, id) on delete cascade;

alter table public.trigger_action_plans drop constraint if exists trigger_action_plans_trigger_id_fkey;
alter table public.trigger_action_plans add constraint trigger_action_plans_trigger_same_user
  foreign key (user_id, trigger_id) references public.distraction_triggers (user_id, id) on delete cascade;

alter table public.trigger_plan_outcomes drop constraint if exists trigger_plan_outcomes_trigger_id_fkey;
alter table public.trigger_plan_outcomes add constraint trigger_plan_outcomes_trigger_same_user
  foreign key (user_id, trigger_id) references public.distraction_triggers (user_id, id) on delete cascade;

alter table public.trigger_plan_outcomes drop constraint if exists trigger_plan_outcomes_plan_id_fkey;
alter table public.trigger_plan_outcomes add constraint trigger_plan_outcomes_plan_same_user
  foreign key (user_id, plan_id) references public.trigger_action_plans (user_id, id) on delete cascade;

alter table public.class_assessments drop constraint if exists class_assessments_class_id_fkey;
alter table public.class_assessments add constraint class_assessments_class_same_user
  foreign key (user_id, class_id) references public.classes (user_id, id) on delete cascade;

-- ---------------------------------------------------------------------------
-- NOT CHANGED, and why — so the omissions read as decisions rather than misses:
--
--   session_sets.exercise_id -> exercises(id)    exercises is a shared catalogue,
--   plan_sessions.workout_id -> workouts(id)     not user-scoped. A composite key
--                                                would be wrong here.
--   class_assessments.task_id -> tasks(id)       tasks IS user-scoped, but the
--                                                column is nullable with ON DELETE
--                                                SET NULL; left for a follow-up so
--                                                this migration stays one shape.
--   *_user_id_fkey -> auth.users(id)             the ownership anchor itself.
-- ---------------------------------------------------------------------------

-- PREFLIGHT (run BEFORE applying to a populated database; each must return 0):
--
--   select count(*) from habit_logs c join custom_habits p on p.id=c.habit_id where c.user_id<>p.user_id;
--   select count(*) from deen_habit_logs c join deen_habits p on p.id=c.habit_id where c.user_id<>p.user_id;
--   select count(*) from session_sets c join workout_sessions p on p.id=c.session_id where c.user_id<>p.user_id;
--   select count(*) from coop_tasks c join coop_targets p on p.id=c.target_id where c.user_id<>p.user_id;
--   select count(*) from plan_sessions c join workout_plans p on p.id=c.plan_id where c.user_id<>p.user_id;
--   select count(*) from distraction_events c join distraction_triggers p on p.id=c.trigger_id where c.user_id<>p.user_id;
--   select count(*) from trigger_action_plans c join distraction_triggers p on p.id=c.trigger_id where c.user_id<>p.user_id;
--   select count(*) from trigger_plan_outcomes c join distraction_triggers p on p.id=c.trigger_id where c.user_id<>p.user_id;
--   select count(*) from trigger_plan_outcomes c join trigger_action_plans p on p.id=c.plan_id where c.user_id<>p.user_id;
--   select count(*) from class_assessments c join classes p on p.id=c.class_id where c.user_id<>p.user_id;
--
-- A non-zero result is not a reason to skip this migration — it is a
-- pre-existing cross-tenant row that must be investigated and cleaned first.
