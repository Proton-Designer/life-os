-- Requested by the Opus Lead's 2026-08-19 review: checkin_allocations has
-- unique(checkin_id, domain), but nothing stopped two `checkins` rows from
-- sharing the same window_start for the same user — a reload mid-save, two
-- tabs, or a client retry after a timeout where the write actually landed
-- would double-write and silently double-count minutes into Signal:Noise,
-- with nothing on screen indicating anything was wrong. Made impossible at
-- the database level rather than merely unlikely at the UI level.
--
-- Partial (where kind = 'allocation') so it can't affect the 23 legacy
-- kind='point' rows, which have window_start = null anyway (a plain unique
-- index would treat all those nulls as non-conflicting per Postgres NULL
-- semantics regardless, but partial is the more honest statement of intent
-- and matches kind's own check constraint's spirit).
create unique index checkins_one_allocation_per_window
  on public.checkins (user_id, window_start)
  where kind = 'allocation';
