-- HOME-01a: an adjustable daily focus target and a persisted "minimized" morning brief.
--
--   daily_focus_target_minutes    -- the Home "N of 4 Hours today" target, in minutes. NULL = app default 240.
--   weekend_focus_target_minutes  -- optional different target for Saturday/Sunday (the user's LOCAL days,
--                                    resolved in app code with the profile timezone). NULL = use the daily target.
--   morning_brief_collapsed_on    -- the brief_date (a local calendar date) the user minimized. The brief shows
--                                    expanded again as soon as a newer brief_date exists. NULL = never minimized.
--
-- Additive: nullable columns, no backfill, no default. user_settings rows are created lazily, so app
-- writes ensure the row first (same as the wind-down plan).

alter table public.user_settings
  add column daily_focus_target_minutes   smallint null,
  add column weekend_focus_target_minutes smallint null,
  add column morning_brief_collapsed_on   date     null;

alter table public.user_settings
  add constraint user_settings_daily_focus_target_check
    check (daily_focus_target_minutes is null or daily_focus_target_minutes between 30 and 720),
  add constraint user_settings_weekend_focus_target_check
    check (weekend_focus_target_minutes is null or weekend_focus_target_minutes between 30 and 720);

comment on column public.user_settings.daily_focus_target_minutes is
  'HOME-01a: daily focus target in minutes (30-720) for the Home "N of M Hours" strip. NULL = app default 240.';
comment on column public.user_settings.weekend_focus_target_minutes is
  'HOME-01a: optional weekend (local Sat/Sun) focus target in minutes (30-720). NULL = use daily_focus_target_minutes.';
comment on column public.user_settings.morning_brief_collapsed_on is
  'HOME-01a: the brief_date the user minimized the morning brief for; a newer brief_date shows it expanded again. NULL = never minimized.';

-- Verification that examines real catalog state (a check that examines nothing reports success).
do $$
declare
  v_n int;
  v_def text;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'user_settings'
     and ((column_name = 'daily_focus_target_minutes'   and data_type = 'smallint' and is_nullable = 'YES')
       or (column_name = 'weekend_focus_target_minutes' and data_type = 'smallint' and is_nullable = 'YES')
       or (column_name = 'morning_brief_collapsed_on'   and data_type = 'date'     and is_nullable = 'YES'));
  if v_n <> 3 then
    raise exception 'migration 256: expected 3 new nullable columns of the right types, found %', v_n;
  end if;

  for v_def in
    select pg_get_constraintdef(oid) from pg_constraint
     where conrelid = 'public.user_settings'::regclass
       and conname in ('user_settings_daily_focus_target_check', 'user_settings_weekend_focus_target_check')
  loop
    if v_def not like '%30%' or v_def not like '%720%' then
      raise exception 'migration 256: unexpected CHECK definition: %', v_def;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> 5 then
    raise exception 'migration 256: expected both CHECK constraints (30-720), found %', v_n - 3;
  end if;
end
$$;
