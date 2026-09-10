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
-- parallel constraint. blocked_from keeps its hard, two-way pairing with
-- status='blocked' -- that one's structural, unblocking needs it. A CHECK
-- is retroactive (it binds every row that already exists, not just rows
-- future code writes), so blocked_since and blocked_reason are BOTH
-- one-directional instead, exactly like blocked_reason always was: non-null
-- is only PERMITTED while blocked, never REQUIRED. A two-way pairing on
-- blocked_since would reject this ADD CONSTRAINT outright, on the one row
-- that predates this column ("Add email notification automation to
-- requesting portal") -- it's blocked with blocked_since NULL by the
-- header's own no-backfill instruction above, and the constraint has to
-- accept the data that exists today, not just the data new code will
-- write. NULL blocked_since on a blocked row therefore means "blocked
-- before migration 148 existed," not "missing data" -- do not tighten this
-- back to a two-way pairing later on the assumption it's an oversight.
alter table public.coop_tasks drop constraint coop_tasks_blocked_from_consistency;

alter table public.coop_tasks add constraint coop_tasks_blocked_from_consistency check (
  (status = 'blocked' and blocked_from is not null) or
  (status <> 'blocked' and blocked_from is null and blocked_since is null and blocked_reason is null)
);
