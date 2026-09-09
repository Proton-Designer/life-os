-- DRAFT — NOT a numbered migration. Per supabase/migrations/ALLOCATIONS.md's
-- rule ("Numbers are allocated by the LifeOS lead only. Nobody
-- self-assigns"), this file lives OUTSIDE supabase/migrations/ so it can
-- never be mistaken for an applied or pending migration. File it as
-- supabase/migrations/<N>_scheduled_notify_action.sql once a number is
-- allocated, then delete this draft. (ALLOCATIONS.md shows `144` as next
-- free as of this writing -- not claimed, just noted.)
--
-- L7 follow-up: the lead's ruling that "adding reminders" isn't satisfied
-- by a scheduled action that runs correctly but never reaches the owner --
-- "a silent success is the worst outcome this program can produce." This
-- adds the DELIVERY half: a `tool_name = 'notify'` scheduled action that
-- sends a real web push (lib/notifications/send-push.ts, a NEW generic
-- function, NOT a refactor of supabase/functions/dispatch-notifications --
-- that function is live, prayer-specific, and explicitly not touched here
-- per the lead's own instruction, duplication accepted deliberately).
--
-- WIDENS mcp_scheduled_actions.tool_name's CHECK from ('write') to
-- ('write', 'notify') -- additive, does not touch any existing row (every
-- row today is 'write'). `args` for a notify row is `{title, body}`, not
-- write.ts's `{domain, entity, action, id?, patch?}` shape -- scheduler-
-- core.ts's own createScheduledActionCore branches on `patch.tool_name`
-- before validating anything else.
--
-- mcp_notification_dispatch_log IS THE IDEMPOTENCY MECHANISM (the lead's
-- requirement #1 for notify: "reuse notification_log's dedup shape -- a
-- key + a date -- rather than inventing one"). A NEW table, not a write
-- into notification_log itself: that table is
-- supabase/functions/dispatch-notifications/index.ts's own bookkeeping
-- (prayer-name keys, no scheduled_action_id concept at all), and touching
-- its schema or its rows from this codebase would be exactly the "on the
-- way past" refactor the lead ruled out. Same PATTERN (a key plus a local
-- calendar date, unique together), a DIFFERENT table this feature owns
-- outright.
--
-- KEYED BY (scheduled_action_id, sent_date), NOT a precise per-occurrence
-- timestamp: `claimDueActions`'s own atomic-bump claim mechanism
-- overwrites `next_run_at` as part of claiming (see lib/mcp/
-- scheduler-runner.ts's own comment), so the ORIGINAL intended fire
-- instant isn't recoverable from the row after a claim -- but the LOCAL
-- CALENDAR DATE (computed via localDateString, never UTC, AGENTS.md's
-- rule) is exactly the right granularity anyway: a one-off reminder only
-- ever has one real occurrence, so "already sent today" IS "already
-- sent"; a recurring reminder's cadence is at coarsest daily, so
-- "already sent today" correctly suppresses a same-day retry-after-crash
-- double-send while still sending tomorrow's real, distinct occurrence.
--
-- No begin;/commit; -- the runner (apply-migration.sh) owns the
-- transaction.

alter table public.mcp_scheduled_actions
  drop constraint mcp_scheduled_actions_tool_name_check;
alter table public.mcp_scheduled_actions
  add constraint mcp_scheduled_actions_tool_name_check check (tool_name in ('write', 'notify'));

create table public.mcp_notification_dispatch_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  scheduled_action_id uuid not null references public.mcp_scheduled_actions(id) on delete cascade,
  sent_date date not null,
  created_at timestamptz not null default now(),
  unique (scheduled_action_id, sent_date)
);

comment on table public.mcp_notification_dispatch_log is
  'L7 notify delivery idempotency: at-least-once firing means the SAME '
  'occurrence can be attempted twice (a crash between claim and finalize, '
  'see scheduler-runner.ts). Before actually sending a push, the runner '
  'inserts here first -- a unique_violation on (scheduled_action_id, '
  'sent_date) means this occurrence was already sent, and the send is '
  'skipped (reported ok, not re-attempted), the same no-op-on-conflict '
  'idiom save_allocation_checkin already established for this codebase.';

create index mcp_notification_dispatch_log_user_id_idx on public.mcp_notification_dispatch_log (user_id);

alter table public.mcp_notification_dispatch_log enable row level security;

-- Select-only for the owning user (same posture migration 130 took on
-- mcp_audit_log: "an audit log its subject can edit is not an audit
-- log" -- this is a delivery ledger with the identical shape of concern).
-- INSERT/UPDATE/DELETE happen exclusively through the service-role runner.
create policy mcp_notification_dispatch_log_select_own on public.mcp_notification_dispatch_log
  for select using (user_id = (select auth.uid()));
