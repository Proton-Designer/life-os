-- 264: Which Work tab a plan line belongs to.
--
-- "Work" is a domain with the person's own tabs (user_subdomains of kind 'job' or 'business'). A plan line attached to
-- Work now also records WHICH tab, so a Business tab's line reaches that tab's Kill List and a job tab's line reaches
-- the Backlog. `plan_subdomain` holds the tab's `user_subdomains.key` (a slug); `plan_area` still holds the behaviour
-- ('business' for a Business tab, 'work' for a job tab), so every existing reader keeps working unchanged.
--
-- One additive nullable text column on `tasks`; no backfill, no index, no policy change. NULL = no tab chosen (every
-- row that exists today). The key is not a foreign key: tabs are archived and renamed, and an old line must survive that.
-- No begin;/commit; -- the runner owns the transaction.

alter table public.tasks
  add column plan_subdomain text
    constraint tasks_plan_subdomain_length check (char_length(plan_subdomain) between 1 and 80);

comment on column public.tasks.plan_subdomain is
  'user_subdomains.key of the Work tab a plan line was attached to (plan_area is business or work). NULL = none chosen.';

do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'tasks' and column_name = 'plan_subdomain'
     and data_type = 'text' and is_nullable = 'YES';
  if v_n <> 1 then
    raise exception 'migration 264: expected tasks.plan_subdomain text nullable, found % matching columns', v_n;
  end if;

  select count(*) into v_n
    from pg_constraint
   where conrelid = 'public.tasks'::regclass and conname = 'tasks_plan_subdomain_length';
  if v_n <> 1 then
    raise exception 'migration 264: missing CHECK tasks_plan_subdomain_length';
  end if;

  raise notice 'migration 264 verified: tasks.plan_subdomain text nullable with a 1..80 length CHECK';
end $$;
