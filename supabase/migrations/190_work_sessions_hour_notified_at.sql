-- 190: Hour-completion notification flag (Phase 2 #P2-04, Team A / Sonnet ENG 2).
--
-- "The Hour" (the Lock-In work_sessions timer already shipped in Phase 1) has
-- no out-of-app signal when an active session crosses 60 minutes -- a user
-- who backgrounds or closes the tab only finds out by reopening it. This
-- column is the idempotency guard for a one-time push
-- (lib/business/hour-completion.ts): set once, the first time an active
-- session's elapsed time reaches 60 minutes.
--
-- Piggybacks on the EXISTING 5-minute pg_cron -> pg_net job that already
-- hits app/api/cron/scheduled-actions/route.ts (registered 2026-09-09, see
-- this file's own "Operator actions on production" entry in
-- ALLOCATIONS.md) -- no new cron registration needed.
--
-- No RLS change: work_sessions_own_row (058_cross_tenant_fk_hardening.sql)
-- already covers this column for normal user reads. The poller writes it
-- via the service-role client, which bypasses RLS by design -- the same
-- path lib/mcp/scheduler-runner.ts already uses for push dispatch.

alter table public.work_sessions
  add column if not exists hour_notified_at timestamptz null;

comment on column public.work_sessions.hour_notified_at is
  'Set once, by lib/business/hour-completion.ts''s poller, the first time '
  'this session''s elapsed time reaches 60 minutes while still active '
  '(ended_at is null). Idempotency guard against double-notifying on '
  'repeated 5-minute polls. Never written by any user-facing action.';

-- The poller's own WHERE clause (counts_toward_hours, ended_at is null,
-- hour_notified_at is null, started_at old enough) targets a small,
-- infrequent set (active sessions are rare) -- a partial index keeps that
-- scan cheap regardless of how large work_sessions grows. Mirrors migration
-- 057's own work_sessions_user_counting_idx reasoning for the same table.
create index if not exists work_sessions_hour_pending_idx
  on public.work_sessions (started_at)
  where counts_toward_hours and ended_at is null and hour_notified_at is null;
