-- 122 — `user_settings.weekday_baselines` (R58).
--
-- The evening close shows "Hours today 2:10" with nothing to compare it to,
-- because there is nowhere to record what a normal day looks like for this
-- person. This is that column. Day Won reads it; A3's rhythm screen will write
-- it; a small settings editor writes it in the meantime so the value has a
-- producer before that screen exists.
--
-- NULL MEANS NEVER SET, AND THAT IS NOT ZERO. R58 is explicit and it decides
-- the whole design: until a baseline exists the comparison is ABSENT, not
-- failed. Rendering "2:10 / 0:00" against an unset baseline reads as a day
-- massively exceeded; "0 of 0" reads as a day lost. Both are answers to a
-- question the user has never been asked, and this codebase has now paid for
-- that confusion six separate times tonight — in the arbiter, the 115 bridge,
-- `mit_rank`, `relevance_floor`, `tasks.domain` and `dump_source`.
--
-- ZERO IS A REAL VALUE AND IT MEANS REST. A baseline of 0 is a deliberate rest
-- day: it reads "rest day", never won and never lost. That is why the range is
-- 0..12 rather than 1..12 — outlawing zero would force someone with a genuine
-- day off to either lie or leave it unset, and "unset" already means something
-- else.
--
-- WHY AN ARRAY AND NOT SEVEN COLUMNS. The value is one concept — a week's
-- shape — and it is always read and written whole. Seven columns would make
-- "is a baseline set?" a seven-way question with six wrong answers available,
-- and a partial write would leave a week half-described with nothing saying so.
--
-- THE CHECK ENFORCES ALL THREE PROPERTIES, because a column that accepts a
-- 3-element array or a NULL element is not the type this says it is:
--   * exactly 7 entries (a week), so index 0..6 always resolves
--   * no NULL elements — per-element absence is NOT a state this models; the
--     whole array is set or it is not
--   * every value within 0..12, via `<@`, which is containment rather than a
--     subquery (a CHECK cannot contain one)
--
-- 12 is the ceiling because a "baseline" above twelve hours is not a baseline,
-- it is a crisis, and a comparison against it would only ever report failure.
--
-- No `begin;`/`commit;` — the runner owns the transaction.

alter table public.user_settings
  add column weekday_baselines smallint[] null;

alter table public.user_settings
  add constraint user_settings_weekday_baselines_check
  check (
    weekday_baselines is null
    or (
      array_length(weekday_baselines, 1) = 7
      and array_position(weekday_baselines, null) is null
      and weekday_baselines <@ array[0,1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]
    )
  );

comment on column public.user_settings.weekday_baselines is
  'Target focus hours per weekday, index 0 = Sunday .. 6 = Saturday. NULL means NEVER SET -- the Day Won comparison is then ABSENT, not failed. A 0 entry is a deliberate rest day: it reads "rest day", never won or lost. Always read and written whole.';

do $$
declare
  v_def text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_settings'
       and column_name = 'weekday_baselines' and data_type = 'ARRAY'
  ) then
    raise exception 'migration 122: user_settings.weekday_baselines is absent or not an array';
  end if;

  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'user_settings_weekday_baselines_check';
  if v_def is null then
    raise exception 'migration 122: the weekday_baselines CHECK is absent -- the column would accept any smallint array of any length';
  end if;

  -- Assert each property by name. A CHECK that only tested length would accept
  -- a week of 99s; one that only tested range would accept a 3-day week. An
  -- existence check would accept either.
  if v_def not like '%array_length%' then
    raise exception 'migration 122: CHECK does not constrain LENGTH: %', v_def;
  end if;
  if v_def not like '%array_position%' then
    raise exception 'migration 122: CHECK does not reject NULL elements: %', v_def;
  end if;
  if v_def not like '%<@%' then
    raise exception 'migration 122: CHECK does not constrain the value RANGE: %', v_def;
  end if;

  raise notice 'migration 122 verified: weekday_baselines smallint[], CHECK constrains length, null-elements and range';
end $$;
