-- A3 Part 3 (generic practice engine): a reading log for any text, not a
-- quran_sessions reuse. Verified before building, not assumed: all 6 real
-- consumers of quran_sessions (get-domain-snapshots.ts's quranWeekPages/
-- quranWeeklyTarget, insights/page.tsx, deen/page.tsx, calendar/actions.ts,
-- deen/actions.ts, settings/export/route.ts) treat every row in that table
-- as a real Qur'an session -- a non-Qur'an "my own practice" reading entry
-- would silently inflate Deen's own weekly-pages KPI and data export. A
-- schema can have the right columns and still mean the wrong thing; this
-- is the same shape as quran_sessions' own juz/surah being merely nullable
-- rather than actually generic. DO NOT reuse quran_sessions for this --
-- if that proposal comes back up, this paragraph is why it was rejected
-- once already.
--
-- Deliberately minimal, mirroring quran_sessions' own clean shape (date,
-- a unit count, optional metadata) rather than growing scope: no area_key
-- column, since this is reachable only through Faith's "my own practice"
-- branch today (BOSS-VISION §4b.3) -- if a second area ever wants a
-- reading log, that is a real decision to make then (reuse this table for
-- real, or build another), not one to pre-answer with a column nobody
-- reads yet. No weekly-target field either -- target tracking is a
-- separate, not-yet-resolved question (see the Lead's own open question on
-- weekly_goals' CHECK/UI-surface scope) and does not belong baked into a
-- log table regardless of how that resolves.

begin;

create table public.reading_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  -- Generic unit count -- pages, chapters, whatever the user's text is
  -- measured in. No juz/surah-style Qur'an-specific columns: this table
  -- exists specifically because those don't generalize.
  units_read integer not null check (units_read > 0),
  -- Optional book/text title -- free text, since the whole point is any
  -- text, not a fixed catalogue.
  source text null,
  created_at timestamptz not null default now()
);

create index reading_logs_user_id_idx on public.reading_logs (user_id);
create index reading_logs_user_date_idx on public.reading_logs (user_id, date);

alter table public.reading_logs enable row level security;

create policy "reading_logs_own_row"
  on public.reading_logs for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
