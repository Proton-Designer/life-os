-- 253 — Launch sequence + Wind-down columns (IA-P4a). (Sonnet ENG 1; number allocated by the
-- Opus lead, 2026-10-04.) Additive only: three nullable columns on morning_routine_items, three
-- nullable columns on user_settings. NO backfill, nothing deleted or rewritten; every existing
-- row keeps meaning exactly what it meant (NULL = "not set").
--
-- morning_routine_items (188) becomes the Launch sequence's steps:
--   if_cue        the "when ..." half of an if-then step ("when I sit at my desk"); `label` stays
--                 the "then I ..." action. <= 80 chars, blank not allowed (NULL = a plain step).
--   fallback_text the 2-minute version of the step. Same shape.
--   habit_id      optional link to an identity habit: ticking the step also casts that habit's
--                 vote for the local day (app code, one action). COMPOSITE tenancy FK
--                 (user_id, habit_id) -> identity_habits (user_id, id), exactly the 175/188
--                 pattern. ON DELETE SET NULL IS COLUMN-SCOPED — `set null (habit_id)` (PG 15+,
--                 server is 17.6). A bare `on delete set null` would also null user_id (NOT NULL)
--                 and make every delete of a linked habit fail (migration 129 / memory
--                 composite-fk-set-null-trap). Habits are archived, not deleted, so this is the
--                 safety net, not the hot path.
--
-- user_settings (066/122, one row per user, written by upsert) gets the set-once wind-down plan:
--   wake_time          'HH:MM' local, when you want to be up.
--   sleep_need_minutes how long you need (6h-10h). bedtime = wake_time - sleep_need_minutes.
--   wind_down_minutes  how long before bedtime the wind-down starts (15-120; the app default is
--                      45 when NULL). wind_down_start = bedtime - wind_down_minutes.
-- Bedtime and wind-down start are DERIVED in app code (lib/rhythm/wind-down.ts), never stored, so
-- they cannot drift from the three inputs. sleep_intents (183) is untouched and keeps its data.
--
-- No begin;/commit; — the runner owns the transaction.

alter table public.morning_routine_items
  add column if_cue        text null,
  add column fallback_text text null,
  add column habit_id      uuid null;

alter table public.morning_routine_items
  add constraint morning_routine_items_if_cue_check
    check (if_cue is null or (length(btrim(if_cue)) between 1 and 80)),
  add constraint morning_routine_items_fallback_text_check
    check (fallback_text is null or (length(btrim(fallback_text)) between 1 and 80)),
  add constraint morning_routine_items_habit_same_user
    foreign key (user_id, habit_id) references public.identity_habits (user_id, id)
    on delete set null (habit_id);

comment on column public.morning_routine_items.if_cue is
  'IA-P4a: the "when ..." cue of an if-then step (label is the "then I ..." action). NULL = a plain step.';
comment on column public.morning_routine_items.fallback_text is
  'IA-P4a: the 2-minute version of the step, shown as a fallback chip. NULL = none.';
comment on column public.morning_routine_items.habit_id is
  'IA-P4a: optional identity habit this step counts as a vote for (app code casts the vote with the tick). NULL = not linked. Composite tenancy FK, ON DELETE SET NULL scoped to this column only.';

alter table public.user_settings
  add column wake_time          text     null,
  add column sleep_need_minutes smallint null,
  add column wind_down_minutes  smallint null;

alter table public.user_settings
  add constraint user_settings_wake_time_check
    check (wake_time is null or wake_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint user_settings_sleep_need_minutes_check
    check (sleep_need_minutes is null or sleep_need_minutes between 360 and 600),
  add constraint user_settings_wind_down_minutes_check
    check (wind_down_minutes is null or wind_down_minutes between 15 and 120);

comment on column public.user_settings.wake_time is
  'IA-P4a: set-once wake time, local HH:MM. NULL = never set (Wind-down shows its set-up card; the app falls back to the 21:00 default).';
comment on column public.user_settings.sleep_need_minutes is
  'IA-P4a: hours of sleep you need, in minutes (360-600). bedtime = wake_time - this (derived in app code, never stored).';
comment on column public.user_settings.wind_down_minutes is
  'IA-P4a: minutes before bedtime that wind-down starts (15-120). NULL = app default 45.';

-- Verification that examines real catalog state (a check that examines nothing reports success).
do $$
declare
  v_setcols smallint[];
  v_n int;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'morning_routine_items' and column_name in ('if_cue', 'fallback_text', 'habit_id'))
       or (table_name = 'user_settings' and column_name in ('wake_time', 'sleep_need_minutes', 'wind_down_minutes')));
  if v_n <> 6 then
    raise exception 'migration 253: expected 6 new columns, found %', v_n;
  end if;

  -- The FK must exist, be composite, and its SET NULL must be scoped to ONE column (habit_id).
  select confdelsetcols into v_setcols
    from pg_constraint
   where conname = 'morning_routine_items_habit_same_user'
     and conrelid = 'public.morning_routine_items'::regclass
     and confdeltype = 'n';
  if v_setcols is null then
    raise exception 'migration 253: habit FK missing, or its ON DELETE SET NULL is not column-scoped (would null user_id)';
  end if;
  if array_length(v_setcols, 1) <> 1 then
    raise exception 'migration 253: habit FK SET NULL column list has % columns, expected 1', array_length(v_setcols, 1);
  end if;

  select count(*) into v_n
    from pg_constraint
   where conrelid in ('public.morning_routine_items'::regclass, 'public.user_settings'::regclass)
     and conname in ('morning_routine_items_if_cue_check', 'morning_routine_items_fallback_text_check',
                     'user_settings_wake_time_check', 'user_settings_sleep_need_minutes_check',
                     'user_settings_wind_down_minutes_check');
  if v_n <> 5 then
    raise exception 'migration 253: expected 5 CHECK constraints, found %', v_n;
  end if;

  raise notice 'migration 253 verified: 6 columns, 5 CHECKs, composite habit FK with column-scoped SET NULL';
end $$;
