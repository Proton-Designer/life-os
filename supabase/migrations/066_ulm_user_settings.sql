-- ULM platform tables, batch 1 addition: `user_settings`. Not a ULM-only
-- table — CollegeOS's lead explicitly declined to claim it, so ULM creates
-- it fresh as a platform table other tracks add columns to later. Self-owned
-- (one row per user, `user_id` IS the primary key, not a surrogate id with a
-- unique index) — unlike the parent-derived content tables in this batch,
-- there is no parent row to derive ownership from, so `user_id` comes from
-- `auth.uid()` at insert via a column default, and the RLS `with check` is
-- doing REAL work here (no trigger forces user_id, so a client-supplied
-- mismatched user_id is only caught by this check — do not later add a
-- trigger that also forces user_id to auth.uid() on this table, which would
-- make the with check tautological; that combination was a real
-- privilege-escalation bug in ULM's original spec on a different table).
--
-- Column list and `desired_retention` bound (0.70-0.99) sourced from ULM's
-- `20260815040000_l1a_schema.sql`, deliberately narrowed to the Opus Lead's
-- scoped list — `timezone` is dropped (LifeOS's `profiles.timezone` already
-- covers it; a second one would be a live collision waiting to happen, not
-- a merge). Every ULM-specific column is defaulted so a row created by
-- LifeOS's signup flow (which knows nothing about FSRS) is still valid.

create table public.user_settings (
  user_id                 uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  daily_new_limit         int not null default 5 check (daily_new_limit between 0 and 50),
  notification_enabled    boolean not null default true,
  notification_time       time not null default '19:00',
  desired_retention       numeric(3,2) not null default 0.90
                             check (desired_retention between 0.70 and 0.99),
  ai_grading_enabled      boolean not null default true,
  session_target_minutes  int not null default 8
);

alter table public.user_settings enable row level security;

create policy user_settings_own_row on public.user_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
