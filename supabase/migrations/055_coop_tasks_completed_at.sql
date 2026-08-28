-- Engineer C, 2026-08-28 batch 5, item 3.
--
-- The Pipeline's new "Past" section needs to know how long a task has sat
-- in `complete` — coop_tasks has no timestamp for that today. Additive:
-- nullable column, no existing constraint touches it, safe in either
-- deploy order per docs/DEPLOYING.md.
--
-- Backfill deliberately sets existing complete rows to now(), NOT
-- created_at. Backfilling to created_at would make a pile of tasks vanish
-- into Past the instant this deploys (created_at is often long before the
-- task actually finished), which reads as data loss. Starting the 7-day
-- clock at migration time means nothing already-complete disappears
-- unexpectedly on deploy — the earliest anything can hit Past is 7 days
-- from right now.
begin;

alter table public.coop_tasks add column completed_at timestamptz null;

update public.coop_tasks
set completed_at = now()
where status = 'complete' and completed_at is null;

commit;
