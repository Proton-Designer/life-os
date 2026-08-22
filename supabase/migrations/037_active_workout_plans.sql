-- Fitness system rebuild, Phase 1 (Engineer A) — active-plan slots.
-- Two slots, one micro one routine, per spec's confirmed product decision:
-- "Two slots — one `micro`, one `routine`. Neither required. Zero, one, or
-- both." `on delete set null` is deliberate — deleting an active plan
-- deactivates the slot instead of erroring; the confirm dialog in the UI
-- must name that consequence (see plan's logic-gap resolution #2).

create table public.active_workout_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  micro_plan_id uuid references public.workout_plans(id) on delete set null,
  routine_plan_id uuid references public.workout_plans(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.active_workout_plans enable row level security;

create policy "active_workout_plans_own_row"
  on public.active_workout_plans for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Data migration, part 2: activate the "Starter Reps" plan created in
-- 036's data migration into the micro slot, for every user that has one.
-- Idempotent via upsert on the primary key — re-running this file is safe
-- and does not clobber a routine_plan_id a later migration/action set.
insert into public.active_workout_plans (user_id, micro_plan_id)
select wp.user_id, wp.id
  from public.workout_plans wp
  where wp.kind = 'micro' and lower(wp.name) = lower('Starter Reps') and not wp.archived
on conflict (user_id) do update
  set micro_plan_id = excluded.micro_plan_id,
      updated_at = now()
  where public.active_workout_plans.micro_plan_id is null;
