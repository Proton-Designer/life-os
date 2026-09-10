-- 148: optional reason + timestamp for a blocked coop_task.
--
-- Ayman: "if a specific task gets put into the blocked section... there is
-- a popup that allows the user to enter (optionally) what exactly its
-- blocked on, so then the user clicks/presses on the item it should show
-- what its blocked on, and since when."
--
-- WRITE-ONLY BY THIS MIGRATION: the Opus Lead applies it. Do not backfill
-- blocked_since for the one currently-blocked row ("Add email notification
-- automation to requesting portal") -- its updated_at is today and it was
-- PROBABLY blocked today, but probably is not evidence, and manufacturing
-- a timestamp from a proxy is exactly the mistake 147's corrective
-- migration (updated_at defaulted to now() on five tables, falsely dating
-- 54 of 77 task rows to migration time) had to fix this week. Left NULL,
-- read by the app as "blocked, start date not recorded" -- an honest gap,
-- never a guess.

alter table public.coop_tasks
  add column blocked_reason text null check (blocked_reason is null or length(btrim(blocked_reason)) > 0),
  add column blocked_since timestamptz null;

-- Extends coop_tasks_blocked_from_consistency (028) rather than inventing a
-- parallel constraint: blocked_since now follows the same non-null-iff-
-- blocked pairing blocked_from already has, and blocked_reason may only be
-- non-null when blocked (it may still be null while blocked -- the reason
-- is optional, the pairing is one-directional).
alter table public.coop_tasks drop constraint coop_tasks_blocked_from_consistency;

alter table public.coop_tasks add constraint coop_tasks_blocked_from_consistency check (
  (status = 'blocked' and blocked_from is not null and blocked_since is not null) or
  (status <> 'blocked' and blocked_from is null and blocked_since is null and blocked_reason is null)
);
