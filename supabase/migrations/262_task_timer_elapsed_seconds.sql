-- 262: Banked time on a plan line -- what makes Pause / Resume possible.
--
-- A plan line can already run an inline timer (`timer_started_at`, migration 260) or a Deep Work / Deep Study session.
-- Pausing either "closes out" the running stretch; Resume continues from where it stopped. The stretches already worked
-- are BANKED here, in whole seconds, and the row's state is DERIVED, never stored as a flag:
--
--   idle      timer_started_at is null and timer_elapsed_seconds = 0
--   running   timer_started_at is not null (an inline timer), or an active work session whose objective is this task
--   paused    timer_started_at is null and timer_elapsed_seconds > 0 and not completed
--
-- Total time worked = timer_elapsed_seconds + (running inline ? now - timer_started_at : 0). A countdown's remaining time
-- is planned_duration_minutes * 60 - total; a count-up shows total.
--
-- One additive column, NOT NULL with a constant default (a metadata-only change on PG 11+, no table rewrite), so every
-- existing row reads as "nothing banked" and every existing writer behaves exactly as before. RLS is unchanged.
-- No begin;/commit; -- the runner owns the transaction.

alter table public.tasks
  add column timer_elapsed_seconds integer not null default 0
    constraint tasks_timer_elapsed_seconds_nonneg check (timer_elapsed_seconds >= 0);

comment on column public.tasks.timer_elapsed_seconds is
  'Seconds already worked on this plan line across paused stretches (inline timer segments and ended Deep Work / Deep Study sessions, banked from their DB-recorded duration). 0 = nothing banked. A running timer is timer_started_at; the total is this plus the running stretch.';

-- Verification that examines real catalog state (a check that examines nothing reports success).
do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'tasks' and column_name = 'timer_elapsed_seconds'
     and data_type = 'integer' and is_nullable = 'NO' and column_default = '0';
  if v_n <> 1 then
    raise exception 'migration 262: expected timer_elapsed_seconds integer not null default 0, found % matching columns', v_n;
  end if;

  select count(*) into v_n
    from pg_constraint
   where conrelid = 'public.tasks'::regclass and conname = 'tasks_timer_elapsed_seconds_nonneg';
  if v_n <> 1 then
    raise exception 'migration 262: missing CHECK tasks_timer_elapsed_seconds_nonneg';
  end if;

  raise notice 'migration 262 verified: tasks.timer_elapsed_seconds integer not null default 0 with a non-negative CHECK';
end $$;
