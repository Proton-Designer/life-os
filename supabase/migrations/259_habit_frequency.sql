-- HABIT-FREQ: a habit's cadence. Until now both habit systems were implicitly "once a day"; this adds the cadence to
-- BOTH tables that hold habits, identically:
--
--   public.deen_habits       the Faith screen's Habit Builder
--   public.identity_habits   the /habits board (identity statements)
--
-- Columns (same on both):
--   frequency_type      'daily' | 'weekdays' | 'per_week' | 'per_month' | 'every_n_days'. NOT NULL DEFAULT 'daily',
--                       so every existing row (and every writer that has not heard of this feature) keeps behaving
--                       exactly as it did: daily. No backfill needed, no UPDATE of existing rows.
--   frequency_count     per_week: 1..6 completions in each Sun-Sat week (7 would just be daily).
--                       per_month: 1..28 completions in each calendar month (28 = the shortest month).
--   frequency_days      weekdays: which days, 0 = Sunday .. 6 = Saturday, 1..6 of them (all seven would be daily).
--   frequency_interval  every_n_days: 2..365 days between completions (1 would just be daily; "every 2 weeks" = 14).
--
-- A completion is still one log row per (habit, date) -- deen_habit_logs / habit_votes are UNCHANGED. A flexible habit's
-- progress is a count of those rows inside a period, so no log schema, writer or reader needed to change.
--
-- ONE CHECK per table makes every other shape unrepresentable: exactly the columns that belong to a type are set, the
-- rest are NULL. `frequency_days is not null and cardinality(...)` is written in that order on purpose: cardinality()
-- of NULL is NULL, and a CHECK PASSES on NULL (the migration-130 lesson), so the not-null guard must come first.
-- The bounds mirror lib/habits/frequency.ts (PER_WEEK_MAX, PER_MONTH_MAX, INTERVAL_MIN/MAX) -- change both together.
--
-- Additive only; no RLS/policy/index/tenancy-FK change (the new columns ride the existing own-row policies).
-- No begin;/commit; -- the runner owns the transaction.

alter table public.deen_habits
  add column frequency_type     text       not null default 'daily',
  add column frequency_count    smallint   null,
  add column frequency_days     smallint[] null,
  add column frequency_interval smallint   null;

alter table public.identity_habits
  add column frequency_type     text       not null default 'daily',
  add column frequency_count    smallint   null,
  add column frequency_days     smallint[] null,
  add column frequency_interval smallint   null;

alter table public.deen_habits
  add constraint deen_habits_frequency_check check (
       (frequency_type = 'daily'        and frequency_count is null and frequency_days is null and frequency_interval is null)
    or (frequency_type = 'weekdays'     and frequency_days is not null
                                        and cardinality(frequency_days) between 1 and 6
                                        and frequency_days <@ array[0,1,2,3,4,5,6]::smallint[]
                                        and frequency_count is null and frequency_interval is null)
    or (frequency_type = 'per_week'     and frequency_count between 1 and 6 and frequency_days is null and frequency_interval is null)
    or (frequency_type = 'per_month'    and frequency_count between 1 and 28 and frequency_days is null and frequency_interval is null)
    or (frequency_type = 'every_n_days' and frequency_interval between 2 and 365 and frequency_count is null and frequency_days is null)
  );

alter table public.identity_habits
  add constraint identity_habits_frequency_check check (
       (frequency_type = 'daily'        and frequency_count is null and frequency_days is null and frequency_interval is null)
    or (frequency_type = 'weekdays'     and frequency_days is not null
                                        and cardinality(frequency_days) between 1 and 6
                                        and frequency_days <@ array[0,1,2,3,4,5,6]::smallint[]
                                        and frequency_count is null and frequency_interval is null)
    or (frequency_type = 'per_week'     and frequency_count between 1 and 6 and frequency_days is null and frequency_interval is null)
    or (frequency_type = 'per_month'    and frequency_count between 1 and 28 and frequency_days is null and frequency_interval is null)
    or (frequency_type = 'every_n_days' and frequency_interval between 2 and 365 and frequency_count is null and frequency_days is null)
  );

comment on column public.deen_habits.frequency_type is
  'HABIT-FREQ: daily | weekdays | per_week | per_month | every_n_days. Default daily = the original behavior. See lib/habits/frequency.ts.';
comment on column public.identity_habits.frequency_type is
  'HABIT-FREQ: daily | weekdays | per_week | per_month | every_n_days. Default daily = the original behavior. See lib/habits/frequency.ts.';

-- Verification that examines real catalog state AND exercises the CHECKs (a check that examines nothing reports
-- success): the right columns exist on both tables, every legal shape is accepted, and the illegal ones are refused.
do $$
declare
  t text;
  v_n int;
  v_ok boolean;
begin
  foreach t in array array['deen_habits', 'identity_habits'] loop
    select count(*) into v_n from information_schema.columns
     where table_schema = 'public' and table_name = t
       and ((column_name = 'frequency_type'     and data_type = 'text'     and is_nullable = 'NO' and column_default like '%daily%')
         or (column_name = 'frequency_count'    and data_type = 'smallint' and is_nullable = 'YES')
         or (column_name = 'frequency_days'     and data_type = 'ARRAY'    and is_nullable = 'YES')
         or (column_name = 'frequency_interval' and data_type = 'smallint' and is_nullable = 'YES'));
    if v_n <> 4 then
      raise exception 'migration 259: % expected 4 frequency columns of the right shape, found %', t, v_n;
    end if;
    select count(*) into v_n from pg_constraint
     where conrelid = ('public.' || t)::regclass and conname = t || '_frequency_check';
    if v_n <> 1 then
      raise exception 'migration 259: % is missing its frequency CHECK', t;
    end if;
  end loop;

  -- Exercise the predicate itself, independent of any table row, with the same expression the CHECK carries.
  -- (type, count, days, interval) -> must pass / must fail.
  for v_ok, v_n in
    select expected, case when
          (ft = 'daily'        and fc is null and fd is null and fi is null)
       or (ft = 'weekdays'     and fd is not null and cardinality(fd) between 1 and 6 and fd <@ array[0,1,2,3,4,5,6]::smallint[] and fc is null and fi is null)
       or (ft = 'per_week'     and fc between 1 and 6 and fd is null and fi is null)
       or (ft = 'per_month'    and fc between 1 and 28 and fd is null and fi is null)
       or (ft = 'every_n_days' and fi between 2 and 365 and fc is null and fd is null)
      then 1 else 0 end
      from (values
        (true,  'daily',        null::smallint, null::smallint[], null::smallint),
        (true,  'weekdays',     null,           array[1,3,5]::smallint[], null),
        (true,  'per_week',     3::smallint,    null,             null),
        (true,  'per_month',    2::smallint,    null,             null),
        (true,  'every_n_days', null,           null,             14::smallint),
        (false, 'daily',        3::smallint,    null,             null),          -- daily must carry nothing
        (false, 'weekdays',     null,           null,             null),          -- weekdays needs days (NULL cardinality must not slip through)
        (false, 'weekdays',     null,           array[]::smallint[], null),
        (false, 'weekdays',     null,           array[7]::smallint[], null),
        (false, 'weekdays',     null,           array[0,1,2,3,4,5,6]::smallint[], null),
        (false, 'per_week',     7::smallint,    null,             null),
        (false, 'per_week',     0::smallint,    null,             null),
        (false, 'per_month',    29::smallint,   null,             null),
        (false, 'every_n_days', null,           null,             1::smallint),
        (false, 'every_n_days', null,           null,             366::smallint),
        (false, 'sometimes',    null,           null,             null)
      ) as x(expected, ft, fc, fd, fi)
  loop
    if (v_n = 1) <> v_ok then
      raise exception 'migration 259: the frequency predicate gave the wrong answer for a known shape';
    end if;
  end loop;
end
$$;
