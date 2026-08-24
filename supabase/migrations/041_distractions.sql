-- Distractions system (overnight session 2026-08-23/24, Engineer A). Spec:
-- docs/superpowers/specs/2026-08-23-distractions-system.md §1. Same
-- conventions as 027/029: RLS enabled, one own_row policy per table using
-- (select auth.uid()), user_id indexed, RPCs security invoker + explicit
-- search_path + explicit grant.

create table public.distraction_triggers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  domain text not null check (domain in ('deen', 'business', 'school', 'fitness', 'co_op')),
  name text not null,
  description text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index distraction_triggers_unique_name
  on public.distraction_triggers (user_id, domain, lower(name))
  where not archived;

create index distraction_triggers_user_id_idx on public.distraction_triggers (user_id);

alter table public.distraction_triggers enable row level security;

create policy "distraction_triggers_own_row"
  on public.distraction_triggers for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- date is LOCAL (localDateString(now, profile.timezone)) — never UTC. This
-- class of bug has shipped twice in this repo already (see AGENTS.md).
create table public.distraction_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trigger_id uuid not null references public.distraction_triggers(id) on delete cascade,
  date date not null,
  reflection_tier int check (reflection_tier in (1, 2, 3)),
  reflection_entry_id uuid references public.reflection_entries(id) on delete set null,
  created_at timestamptz not null default now()
);

create index distraction_events_user_date on public.distraction_events (user_id, date);

alter table public.distraction_events enable row level security;

create policy "distraction_events_own_row"
  on public.distraction_events for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- trigger_action_plans_one_current is the load-bearing index: it makes "two
-- live plans for one trigger" unrepresentable rather than something the app
-- has to remember not to do. Superseding the old row and inserting the new
-- one therefore happens in ONE transaction (save_trigger_plan below), never
-- two round trips from an action — two round trips would violate this index
-- the moment anything retries.
create table public.trigger_action_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trigger_id uuid not null references public.distraction_triggers(id) on delete cascade,
  body text not null,
  version int not null,
  superseded_at timestamptz,
  supersede_reason text check (supersede_reason in ('followed_failed', 'never_followed')),
  created_at timestamptz not null default now()
);

create unique index trigger_action_plans_version
  on public.trigger_action_plans (trigger_id, version);

create unique index trigger_action_plans_one_current
  on public.trigger_action_plans (trigger_id)
  where superseded_at is null;

create index trigger_action_plans_user_id_idx on public.trigger_action_plans (user_id);

alter table public.trigger_action_plans enable row level security;

create policy "trigger_action_plans_own_row"
  on public.trigger_action_plans for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table public.trigger_plan_outcomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trigger_id uuid not null references public.distraction_triggers(id) on delete cascade,
  plan_id uuid not null references public.trigger_action_plans(id) on delete cascade,
  date date not null,
  followed boolean not null,
  created_at timestamptz not null default now()
);

create unique index trigger_plan_outcomes_one_per_day
  on public.trigger_plan_outcomes (user_id, trigger_id, date);

create index trigger_plan_outcomes_user_id_idx on public.trigger_plan_outcomes (user_id);

alter table public.trigger_plan_outcomes enable row level security;

create policy "trigger_plan_outcomes_own_row"
  on public.trigger_plan_outcomes for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Supersede-then-insert as a single transaction so trigger_action_plans_one_current
-- is never even briefly violated by two round trips from the action layer.
-- p_reason describes why the OLD (superseded) plan is being replaced — null
-- when there is no current plan yet (first plan ever authored for a trigger).
create or replace function public.save_trigger_plan(
  p_trigger_id uuid,
  p_body text,
  p_reason text default null
) returns public.trigger_action_plans
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_next_version int;
  v_row public.trigger_action_plans;
begin
  update public.trigger_action_plans
    set superseded_at = now(), supersede_reason = p_reason
    where trigger_id = p_trigger_id and superseded_at is null;

  select coalesce(max(version), 0) + 1 into v_next_version
    from public.trigger_action_plans
    where trigger_id = p_trigger_id;

  insert into public.trigger_action_plans (user_id, trigger_id, body, version)
  values (auth.uid(), p_trigger_id, p_body, v_next_version)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.save_trigger_plan(uuid, text, text) to authenticated;
