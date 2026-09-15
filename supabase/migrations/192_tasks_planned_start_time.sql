-- 192: Timeboxing -- planned start times for today's plan (Phase 2 #P2-06,
-- Team A / Sonnet ENG 2).
--
-- One column on the existing `tasks` table: `planned_start_time`, "HH:MM"
-- 24h local clock time, same validated-text shape as `sleep_intents.
-- intended_bedtime` (migration 183) -- a clock-time the user typed for
-- THEMSELVES to read back and order a list by, never used in a UTC-instant
-- calculation (resolveLocalTime is for that; this column isn't).
--
-- SCOPE: applies to Night Plan's own already-established "today's plan"
-- set -- rows with `planned_date` set and `mit_rank IS NOT NULL` (the
-- starred/crowned items; see lib/night-plan/night-plan.ts's own header and
-- app/(app)/close/actions.ts's `todaysThree` query, both already treat a
-- null mit_rank as "dumped, not starred, deliberately not part of today's
-- plan"). This column itself has no such restriction at the DB layer (any
-- task row may carry a planned start time) -- the app layer is what scopes
-- which tasks are offered the affordance, same "app decides which rows are
-- reachable, the column itself is generic" shape `due_time` already has.
--
-- NO DURATION/ESTIMATE COLUMN, DELIBERATELY -- night-plan.ts's own header:
-- "WHAT IS DELIBERATELY ABSENT: any duration estimate... The absence is
-- enforced by shape rather than by remembering not to set it." This
-- migration adds exactly one column and nothing that could be read as a
-- duration.
--
-- No begin;/commit; -- the runner owns the transaction.

alter table public.tasks
  add column planned_start_time text
    constraint tasks_planned_start_time_format check (planned_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

comment on column public.tasks.planned_start_time is
  'P2-06 timeboxing: "HH:MM" 24h local clock time the user chose for when they plan to start this task. NULL means unscheduled. Never a duration/estimate -- see this migration''s own header for why that is a deliberate absence, not a gap.';

do $$
declare
  v_col_exists boolean;
  v_check_exists boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'planned_start_time'
  ) into v_col_exists;
  if not v_col_exists then
    raise exception '192: tasks.planned_start_time is absent';
  end if;

  select exists (
    select 1 from pg_constraint
     where conname = 'tasks_planned_start_time_format' and contype = 'c'
  ) into v_check_exists;
  if not v_check_exists then
    raise exception '192: tasks_planned_start_time_format CHECK is absent';
  end if;

  raise notice '192 verified: tasks.planned_start_time present with its HH:MM format CHECK';
end $$;
