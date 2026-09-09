-- 133 (approved in principle by the team-lead; number allocated,
-- ALLOCATIONS.md updated). The real fix for the `updated_at` gap
-- lib/mcp/registry.ts's own header documents finding: TOOL-ARCHITECTURE.md's
-- "updated_at on every entity, no exceptions" had no schema behind it for
-- 67 of 68 tables.
--
-- REVISED FROM THE FIRST DRAFT per the lead's explicit ruling: do NOT
-- blanket-add updated_at to all 8 `deen` tables. A table is either already
-- faithfully served by an existing column, or it is append-only (in which
-- case `created_at` IS its true last-modified time and a second column
-- would be redundant), or it is genuinely mutated in place after creation
-- (in which case, and ONLY in which case, it needs a real trigger-backed
-- `updated_at`). Checked each of the 8 against its actual write paths in
-- app/(app)/deen/actions.ts, not by table-name pattern-matching:
--
--   prayers              -- mutable (markPrayer upserts a status change).
--                           Already faithfully served by `logged_at`, set
--                           on every upsert (verified in migration 130/
--                           registry.ts's own header). NO CHANGE HERE.
--   quran_sessions       -- INSERT ONLY. logQuranSession inserts; no
--                           update/delete path exists anywhere in
--                           actions.ts. `created_at` IS the true
--                           last-modified time. NO CHANGE HERE.
--   reflection_entries   -- INSERT + DELETE only (logReflectionEntry
--                           inserts; decrementReflectionEntry deletes the
--                           most recent row of a tier). No row is ever
--                           UPDATEd in place. `created_at` IS the true
--                           last-modified time. NO CHANGE HERE.
--   sunnah_logs          -- MUTABLE: toggleSunnah upserts `completed` on
--                           an existing (user_id,date,prayer_name,slot)
--                           row; the upsert payload never touches
--                           `created_at`, so a second toggle leaves it
--                           stale at the first-insert time. NEEDS a real
--                           updated_at.
--   adhkar_logs          -- MUTABLE: toggleAdhkar upserts `completed` the
--                           same way, AND the table has no `created_at` at
--                           all today -- nothing to even go stale. NEEDS a
--                           real updated_at.
--   deen_habits          -- MUTABLE, genuinely: updateDeenHabit (name/
--                           anchor_cue), archiveDeenHabit (archived),
--                           setDeenHabitStageOverride (stage_override),
--                           setDeenHabitCommittedDate (committed_date) all
--                           UPDATE an existing row post-creation. `created_at`
--                           would go stale on the very first edit. NEEDS a
--                           real updated_at.
--   deen_habit_logs      -- MUTABLE: toggleDeenHabitLog upserts; has no
--                           created_at at all. NEEDS a real updated_at.
--   deen_weekly_focus    -- MUTABLE: setWeeklyFocus upserts `habit_id` on
--                           (user_id, week_start_date) conflict, which can
--                           genuinely replace which habit a week is
--                           focused on without touching `created_at`.
--                           NEEDS a real updated_at.
--
-- Net: 5 tables get a real column + trigger here, not 8. The other 3 keep
-- their existing timestamp semantics, declared explicitly in
-- lib/mcp/registry.ts rather than silently matching by name.
--
-- Reuses migration 074's existing `public.touch_updated_at()` trigger
-- function -- not reinvented.

-- No begin;/commit; here: apply-migration.sh wraps the file in a single
-- transaction itself.

alter table public.sunnah_logs      add column updated_at timestamptz not null default now();
alter table public.adhkar_logs      add column updated_at timestamptz not null default now();
alter table public.deen_habits      add column updated_at timestamptz not null default now();
alter table public.deen_habit_logs  add column updated_at timestamptz not null default now();
alter table public.deen_weekly_focus add column updated_at timestamptz not null default now();

create trigger sunnah_logs_touch_updated_at       before update on public.sunnah_logs       for each row execute function public.touch_updated_at();
create trigger adhkar_logs_touch_updated_at       before update on public.adhkar_logs       for each row execute function public.touch_updated_at();
create trigger deen_habits_touch_updated_at       before update on public.deen_habits       for each row execute function public.touch_updated_at();
create trigger deen_habit_logs_touch_updated_at   before update on public.deen_habit_logs   for each row execute function public.touch_updated_at();
create trigger deen_weekly_focus_touch_updated_at before update on public.deen_weekly_focus for each row execute function public.touch_updated_at();
