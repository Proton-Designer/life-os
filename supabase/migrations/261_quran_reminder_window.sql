-- 261: The Quran reminder window -- when today's Quran portion shows on Home.
--
-- Home's Today panel shows the Quran row only inside a window of the day (default 10 PM -> 1 AM, which crosses
-- midnight), and the person can move it in Settings. Two additive, nullable columns on `user_settings`, stored the
-- same way `wake_time` is (migration 253): local "HH:MM" text, 24-hour, with a format CHECK. NULL = the app default
-- (22:00 / 01:00) -- the same "NULL means default" convention as wind_down_minutes -- so every existing row and every
-- writer behaves exactly as before and nothing is backfilled.
--
-- start == end is refused by the Server Action (an empty window), not by the database: a CHECK comparing the two
-- would also reject the legitimate "only one of them set" rows, and the action is the single writer.
--
-- RLS on user_settings is unchanged (columns inherit the table's policies). No begin;/commit; -- the runner owns the
-- transaction.

alter table public.user_settings
  add column quran_reminder_start text null,
  add column quran_reminder_end   text null;

alter table public.user_settings
  add constraint user_settings_quran_reminder_start_check
    check (quran_reminder_start is null or quran_reminder_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint user_settings_quran_reminder_end_check
    check (quran_reminder_end is null or quran_reminder_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

comment on column public.user_settings.quran_reminder_start is
  'Start of the daily window in which today''s Quran portion shows on Home, local HH:MM. NULL = app default 22:00. The window may cross midnight (end earlier than start).';
comment on column public.user_settings.quran_reminder_end is
  'End (exclusive) of the Quran reminder window, local HH:MM. NULL = app default 01:00.';

-- Verification that examines real catalog state (a check that examines nothing reports success).
do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'user_settings'
     and column_name in ('quran_reminder_start', 'quran_reminder_end')
     and data_type = 'text' and is_nullable = 'YES';
  if v_n <> 2 then
    raise exception 'migration 261: expected 2 nullable text columns, found %', v_n;
  end if;

  select count(*) into v_n
    from pg_constraint
   where conrelid = 'public.user_settings'::regclass
     and conname in ('user_settings_quran_reminder_start_check', 'user_settings_quran_reminder_end_check');
  if v_n <> 2 then
    raise exception 'migration 261: expected 2 CHECK constraints, found %', v_n;
  end if;

  raise notice 'migration 261 verified: 2 nullable text columns, 2 HH:MM CHECKs';
end $$;
