-- 132 (DRAFT -- NOT ALLOCATED, NOT FROZEN, NOT FOR THIS APPLY BATCH).
--
-- Filed as a draft rather than bundled into 131 because it is a genuinely
-- separate decision the team-lead should make explicitly, not something to
-- wave through alongside the audit-log column fix they actually asked for.
-- Rename/renumber or discard freely; R5 still applies (the LifeOS lead
-- allocates every real migration number) -- this file does not claim 132
-- for real, it borrows it to be reviewable as a concrete diff.
--
-- WHY THIS EXISTS: building lib/mcp/registry.ts for L3's `read` tool, I
-- checked TOOL-ARCHITECTURE.md's hard rule -- "`updated_at` on every
-- entity, at every detail level, no exceptions... that's what makes
-- `detail:'ids'` work as a cheap reuse scan" -- against the ACTUAL schema
-- rather than assuming it already holds. It does not. Grepped the full
-- baseline plus every migration: a genuine, trigger-maintained `updated_at`
-- exists on exactly ONE table in the whole 68-table schema
-- (`ingestion_jobs`, migration 074's `touch_updated_at()` trigger).
--
-- None of `deen`'s 8 tables has one. `prayers` is the one L3 actually reads,
-- and its read entity (lib/mcp/registry.ts) uses `logged_at` as the
-- `updated_at` value instead -- verified, not assumed, to be a faithful
-- stand-in: `markPrayer` (app/(app)/deen/actions.ts) is the table's ONLY
-- write path and sets `logged_at` on every upsert; `unmarkPrayer` deletes
-- the row outright rather than leaving one with a stale timestamp. That
-- verification does not extend to the other 7 deen tables, and this draft
-- is the honest alternative to either (a) leaving `read`'s future
-- `sunnah_log`/`habit`/etc. entities with `updated_at: null` forever, or
-- (b) inventing a column name per table without a trigger behind it, which
-- would silently break the exact reuse promise the rule exists for (a row
-- that changed would read as unchanged forever).
--
-- What this does, mechanically: adds `updated_at timestamptz not null
-- default now()` to each of the 8 `deen` tables, then attaches the SAME
-- `public.touch_updated_at()` trigger function migration 074 already
-- defined -- reused, not reinvented. `adhkar_logs`/`deen_habit_logs` are
-- flip-a-boolean tables with no `created_at` at all today; `default now()`
-- at add-column time backfills every existing row to "now", which is the
-- least-wrong answer available (there is no historical truth to recover)
-- and is no worse than those rows' current total absence of any timestamp.

-- No begin;/commit; here: apply-migration.sh wraps the file in a single
-- transaction itself.

alter table public.prayers          add column updated_at timestamptz not null default now();
alter table public.sunnah_logs      add column updated_at timestamptz not null default now();
alter table public.adhkar_logs      add column updated_at timestamptz not null default now();
alter table public.quran_sessions   add column updated_at timestamptz not null default now();
alter table public.deen_habits      add column updated_at timestamptz not null default now();
alter table public.deen_habit_logs  add column updated_at timestamptz not null default now();
alter table public.deen_weekly_focus add column updated_at timestamptz not null default now();
alter table public.reflection_entries add column updated_at timestamptz not null default now();

create trigger prayers_touch_updated_at           before update on public.prayers           for each row execute function public.touch_updated_at();
create trigger sunnah_logs_touch_updated_at       before update on public.sunnah_logs       for each row execute function public.touch_updated_at();
create trigger adhkar_logs_touch_updated_at       before update on public.adhkar_logs       for each row execute function public.touch_updated_at();
create trigger quran_sessions_touch_updated_at    before update on public.quran_sessions    for each row execute function public.touch_updated_at();
create trigger deen_habits_touch_updated_at       before update on public.deen_habits       for each row execute function public.touch_updated_at();
create trigger deen_habit_logs_touch_updated_at   before update on public.deen_habit_logs   for each row execute function public.touch_updated_at();
create trigger deen_weekly_focus_touch_updated_at before update on public.deen_weekly_focus for each row execute function public.touch_updated_at();
create trigger reflection_entries_touch_updated_at before update on public.reflection_entries for each row execute function public.touch_updated_at();
