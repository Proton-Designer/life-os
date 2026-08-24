-- Overnight session 2026-08-23/24 (Engineer B) — docs/superpowers/specs/
-- 2026-08-23-schedule-calendar.md §1. schedule_events already exists and
-- the School page already reads it, but it carries only a single
-- event_time and no detail fields — not enough to place a class as a
-- real-duration BLOCK on Day's Shape or the new weekly calendar, or to
-- answer "all the necessary information when you click on the class"
-- (Ayman's requirement). Additive and nullable — every existing reader
-- keeps working untouched; end_time/location/instructor are simply absent
-- for any row that predates this migration or never needs them (e.g. a
-- one-off task-style event with no fixed duration).
alter table public.schedule_events
  add column end_time time null,
  add column location text null,
  add column instructor text null;
