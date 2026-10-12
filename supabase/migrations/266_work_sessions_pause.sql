-- 266: Pause is a pause, not a new session.
--
-- Pausing a plan line's Deep Work / Deep Study session ends the row (as before), but now MARKS it paused so that Resume
-- re-opens THE SAME row instead of starting a second one: `paused_at` = when it was paused (NULL = not paused; set only with
-- ended_at). On resume the row is re-opened (ended_at cleared) and started_at is moved FORWARD by the time spent paused, so
-- (ended_at - started_at) and (now - started_at) stay the ACTIVE time everywhere that already computes them, with no reader
-- changed. `original_started_at` keeps the real first start (the day ribbon shows the block from there).
--
-- Two additive nullable columns; no backfill (old paused sessions simply stay ended, and Resume starts a new one as before).
-- No begin;/commit; -- the runner owns the transaction.

alter table public.work_sessions
  add column paused_at timestamptz,
  add column original_started_at timestamptz;

comment on column public.work_sessions.paused_at is
  'Set when a plan line''s session was paused (it is also ended_at); Resume re-opens this row. NULL = not paused.';
comment on column public.work_sessions.original_started_at is
  'The real first start of a session that was paused and resumed (started_at is moved forward by the paused time). NULL = never resumed.';

do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'work_sessions' and column_name in ('paused_at', 'original_started_at')
     and data_type = 'timestamp with time zone' and is_nullable = 'YES';
  if v_n <> 2 then
    raise exception 'migration 266: expected 2 nullable timestamptz columns on work_sessions, found %', v_n;
  end if;
  raise notice 'migration 266 verified: work_sessions.paused_at, original_started_at';
end $$;
