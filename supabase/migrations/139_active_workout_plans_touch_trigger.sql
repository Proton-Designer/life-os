-- 139: `active_workout_plans.updated_at` goes STALE when the row is changed by
-- a foreign-key cascade rather than by application code.
--
-- This table was the one everybody cleared. It already HAS an `updated_at`, and
-- every write in the app sets it explicitly:
--   plan-actions.ts:227      upsert({..., updated_at: new Date().toISOString()})
--   template-actions.ts:87   upsert({..., updated_at: new Date().toISOString()})
-- So the registry entry was marked verified, by the correct method -- reading
-- the app's real write paths. The method was right; its scope was too narrow.
--
-- **The application is not the only writer.** Migration 129 fixed the composite
-- tenancy FK to `on delete set null (micro_plan_id)`, so deleting a workout plan
-- nulls the slot *inside Postgres*, with no application code involved and no
-- trigger to fire. The row changes; `updated_at` does not.
--
-- Proven on production before writing this, in a rolled-back transaction:
--
--   before: updated_at=2000-01-01  micro_plan_id set=true
--   delete from workout_plans ...            <- 129's scoped FK fires
--   after:  updated_at=2000-01-01  micro_plan_id set=false
--   => STALE: the row CHANGED and the marker did not.
--
-- Why it matters beyond tidiness: `read(detail:"ids")` returns `{id, updated_at}`
-- as the cheap "what changed" scan behind the owner's reuse requirement. A model
-- that cached this row would be told it is unchanged after the user's active plan
-- was cleared -- the exact silently-wrong outcome the whole updated_at discipline
-- exists to prevent, and worse than having no marker at all, because a missing
-- marker is visible while a lying one is not.
--
-- A trigger fixes it for BOTH writers at once: `before update ... for each row`
-- fires for any UPDATE, whether it originates in PostgREST, a Server Action, or
-- a foreign-key cascade. The app's explicit assignments stay harmless -- the
-- trigger simply overwrites them with the same value.
--
-- GENERAL LESSON, recorded because it invalidates part of the method used in
-- 133/135/136/137/138: "verified against the app's write paths" is necessary and
-- NOT sufficient. A table reachable by an FK cascade, an ON DELETE action, or an
-- RPC that updates it has writers the application grep will never show.

drop trigger if exists active_workout_plans_touch_updated_at on public.active_workout_plans;
create trigger active_workout_plans_touch_updated_at
  before update on public.active_workout_plans
  for each row execute function public.touch_updated_at();
