-- Tap-to-complete redesign (2026-08-25, Opus Lead ruling) — kill_list_items
-- was the one completion source without a timestamp (tasks.completed_at,
-- prayers.logged_at both already have one), so completed kill-list items
-- couldn't be shown "in order of completion" in the new Completed section.
-- Additive and nullable: every existing row/reader keeps working untouched,
-- no backfill. Callers must set completed_at = now() alongside completed =
-- true, and back to null alongside completed = false, in the same
-- statement — the two columns must never disagree.
alter table public.kill_list_items
  add column completed_at timestamptz null;
