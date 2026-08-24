-- Deep Work / Deep Study split (2026-08-24, Ayman via Opus Lead). One Lock-In
-- session type becomes two: Business-domain sessions stay "deep_work", the
-- new School-adjacent kind is "deep_study" — no domain page owns the latter
-- yet, so the Home Focus module is its only entry/exit point.
--
-- Additive + defaulted: every existing row backfills to 'deep_work' (the
-- only kind that has ever existed), so every existing reader keeps working
-- unchanged until each is explicitly updated to care about the new column.
-- No RLS change — the existing work_sessions own_row policy already covers
-- all columns on the table.
alter table public.work_sessions
  add column kind text not null default 'deep_work'
    check (kind in ('deep_work', 'deep_study'));
