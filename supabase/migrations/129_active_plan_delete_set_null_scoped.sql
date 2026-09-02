-- 129: deleting an ACTIVE workout plan is currently impossible in production.
--
-- 100's cross-tenant FK sweep made the active-slot references composite, so a
-- row can only ever point at a plan belonging to the SAME user:
--
--   foreign key (user_id, micro_plan_id) references workout_plans(user_id, id)
--     on delete set null
--
-- That tenancy guarantee is right and stays. What it silently broke is the
-- delete: `on delete set null` with no column list nulls EVERY column of the
-- referencing key -- user_id as well as micro_plan_id -- and
-- active_workout_plans.user_id is NOT NULL. So deleting a plan that occupies
-- either slot always raises:
--
--   null value in column "user_id" of relation "active_workout_plans"
--   violates not-null constraint
--   DETAIL: Failing row contains (null, null, null, ...)
--
-- The user-visible effect: "Delete" on your active plan does nothing, forever.
-- plan-list.tsx asserts the opposite in a comment -- "Deleting a plan that's
-- currently active is allowed (the DB's `on delete set null` just clears the
-- slot)" -- which is what the composite key changed out from under it. Nothing
-- caught it because the constraint is only reachable by actually deleting an
-- active plan, and the e2e spec that does exactly that had been failing at its
-- residue check, which reads as leftover state rather than a blocked delete.
--
-- Postgres 15+ takes a column list on SET NULL, which is precisely the tool for
-- this: null the plan reference and leave the tenant column alone. Server is
-- 17.6, verified before writing this.
--
-- Not-null is NOT the thing to relax here. A slot row with a null user_id
-- belongs to nobody, is invisible to every RLS policy, and would accumulate
-- unreachable. The key must stay whole; only the plan half may be cleared.

-- No begin;/commit; here: apply-migration.sh wraps the file in a single
-- transaction itself, and a file's own commit; would end the runner's
-- transaction early, leaving anything appended later silently unprotected.
alter table public.active_workout_plans
  drop constraint active_workout_plans_micro_plan_same_user;

alter table public.active_workout_plans
  add constraint active_workout_plans_micro_plan_same_user
  foreign key (user_id, micro_plan_id)
  references public.workout_plans (user_id, id)
  on delete set null (micro_plan_id);

alter table public.active_workout_plans
  drop constraint active_workout_plans_routine_plan_same_user;

alter table public.active_workout_plans
  add constraint active_workout_plans_routine_plan_same_user
  foreign key (user_id, routine_plan_id)
  references public.workout_plans (user_id, id)
  on delete set null (routine_plan_id);
