-- Platform session model: make "does this session count toward focus hours?"
-- a property of the database, not of application code.
--
-- WHY (D-034, corrected 2026-09-01)
--
-- LifeOS is not missing a session table. It has `work_sessions`, whose CHECK is
-- currently `kind in ('deep_work','deep_study')` — and both of those count
-- toward focus hours. So today **every row counts by construction**: nothing
-- non-deep is storable. LifeOS is safe by ACCIDENT, not by design. There is no
-- countability concept here because there has never been anything to exclude.
--
-- ULM's retrieval sessions change that. A daily review is a session, it belongs
-- in this table (D-003 wants one table so Home can answer "what did I do
-- today"), and it must NOT count toward deep-work hours. The corruption does
-- not arrive when a table ports — it arrives **the moment someone widens `kind`
-- to admit 'learn'**, because that CHECK is the only thing currently
-- guaranteeing every row is deep work.
--
-- SEQUENCING, which is the whole point of doing this here and now:
--
--   057 (this file, LifeOS)  add the discriminator, fix every reader to filter
--                            on it. CHECK stays NARROW. Zero behaviour change:
--                            every existing row is `true`.
--   060+ (ULM)               widen the CHECK to admit 'learn'. By then the
--                            readers are already correct.
--
-- Doing it in that order means there is never a window in which the hole is
-- open. If the guard shipped after the widening — which is what would happen if
-- this lived in CollegeOS's 093+ block, since migrations apply in filename
-- order — the corruption would land first and be discovered by someone noticing
-- their focus minutes were wrong.
--
-- WHY A GENERATED COLUMN RATHER THAN A CHECK
--
-- CollegeOS enforces the equivalent with a CHECK constraint tying `hour_index`
-- to `session_type`. A CHECK prevents a *contradictory* row. A generated column
-- is stronger for this purpose: **the value is underivable by application code
-- at all.** There is no bug that can write the wrong answer, because nothing
-- writes it. Given three separate readers already sum this table as focus time
-- (`lib/home/get-home-extras.ts`, `lib/home/get-domain-snapshots.ts`,
-- `lib/checkins/get-allocation-queue.ts`), removing the possibility of a
-- disagreeing write is worth the write-time cost on a hot path.

alter table public.work_sessions
  add column if not exists counts_toward_hours boolean
  generated always as (kind in ('deep_work', 'deep_study', 'exam_prep')) stored;

comment on column public.work_sessions.counts_toward_hours is
  'Generated, never written. True for deep-work-class sessions only. Retrieval '
  '(''learn'') and anti-worry sessions are real sessions that are stored, shown '
  'on the day timeline, and deliberately excluded from the focus-hours metric '
  'every baseline is calibrated against. Readers summing focus time MUST filter '
  'on this column, not on a hardcoded kind list.';

-- Partial index: every focus-time reader filters `counts_toward_hours = true`
-- and a date/user range, and once 'learn' rows exist they will be the majority
-- of this table by row count (a daily review every day vs. a handful of deep
-- work sessions).
create index if not exists work_sessions_user_counting_idx
  on public.work_sessions (user_id, started_at)
  where counts_toward_hours;

-- NOTE: the CHECK on `kind` is deliberately NOT widened here. Widening belongs
-- in the same migration as whatever needs the new value (currently ULM's 060+),
-- so the team introducing a non-counting session kind is the team that has to
-- have read this file.
