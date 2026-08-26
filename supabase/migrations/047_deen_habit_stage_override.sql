-- Manual stage override for Habit Builder (2026-08-25/26, Opus Lead
-- contract, item 6 data layer). Additive, nullable, no default: null means
-- "no override — derive from committed_date as today" (habit-stage.ts's
-- existing 0-13/14-29/30+ rule), matching every existing habit's current
-- behavior unchanged. When set, it wins outright over the derived stage.
--
-- deen_habits_own_row (USING/WITH CHECK on user_id = auth.uid()) is a
-- table-level policy, not column-scoped — it already covers this new
-- column with no further grant needed. Confirmed live via \d
-- public.deen_habits, not assumed.
--
-- deen_habit_logs already has a unique (habit_id, date) constraint
-- (deen_habit_logs_habit_id_date_key, confirmed live) — no dedupe or new
-- constraint needed there for setDeenHabitLogStatus's upsert.
alter table public.deen_habits
  add column stage_override text null
    check (stage_override in ('active_build', 'stabilized', 'locked'));
