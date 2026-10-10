-- 263: Criteria on a plan line -- the detail that would otherwise bloat the task title.
--
-- A plan line's title is what Home shows, so it has to stay short. `plan_criteria` is where the person writes what
-- "done" means for that line (e.g. "all 12 problems, show work, submit before 5"), edited under the line's details in
-- Edit Plan / the nightly plan stage.
--
-- One additive nullable text column on `tasks`; no backfill, no index, no policy change, so every existing row and
-- writer behaves exactly as before. Length is capped by a CHECK so a runaway paste cannot bloat the row.
-- No begin;/commit; -- the runner owns the transaction.

alter table public.tasks
  add column plan_criteria text
    constraint tasks_plan_criteria_length check (char_length(plan_criteria) between 1 and 2000);

comment on column public.tasks.plan_criteria is
  'Free-text criteria / details for a plan line (what must be true for it to count as done). NULL = none. Kept off the title so the title stays short on Home.';

-- Verification that examines real catalog state (a check that examines nothing reports success).
do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'tasks' and column_name = 'plan_criteria'
     and data_type = 'text' and is_nullable = 'YES';
  if v_n <> 1 then
    raise exception 'migration 263: expected tasks.plan_criteria text nullable, found % matching columns', v_n;
  end if;

  select count(*) into v_n
    from pg_constraint
   where conrelid = 'public.tasks'::regclass and conname = 'tasks_plan_criteria_length';
  if v_n <> 1 then
    raise exception 'migration 263: missing CHECK tasks_plan_criteria_length';
  end if;

  raise notice 'migration 263 verified: tasks.plan_criteria text nullable with a 1..2000 length CHECK';
end $$;
