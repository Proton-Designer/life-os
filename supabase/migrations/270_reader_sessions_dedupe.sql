-- 270: make the reader_sessions retry dedupe race-proof.
--
-- recordReaderSessionCore dedupes a retried stretch with select-then-insert; two overlapping sends of the same
-- stretch (mount drain + 'online', pagehide + queued retry, two tabs) can both miss the select and both insert, which
-- double-counts words today. A unique key on the stretch identity makes the second insert fail with 23505, which the
-- code treats as "already recorded".
--
-- Verified read-only 2026-10-20 on the live database: 31 rows, 0 duplicate groups (so step 1 removes nothing there).
-- Idempotent. No begin;/commit; -- the runner owns the transaction.

-- 1. Collapse exact duplicates (same user, book, started_at, ended_at), keeping the lowest id.
with ranked as (
  select id, row_number() over (partition by user_id, book_id, started_at, ended_at order by id) as rn
  from public.reader_sessions
)
delete from public.reader_sessions s
using ranked r
where s.id = r.id and r.rn > 1;

-- 2. The key.
create unique index if not exists reader_sessions_stretch_key
  on public.reader_sessions (user_id, book_id, started_at, ended_at);

-- ── self-check (raises inside the runner's transaction -> rolls the migration back) ──
do $$
declare
  v_n int;
begin
  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and tablename = 'reader_sessions' and indexname = 'reader_sessions_stretch_key'
     and indexdef like '%UNIQUE%';
  if v_n <> 1 then raise exception 'migration 270: reader_sessions_stretch_key missing or not unique'; end if;
end $$;
