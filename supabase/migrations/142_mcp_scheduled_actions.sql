-- DRAFT — NOT a numbered migration. Per supabase/migrations/ALLOCATIONS.md's
-- rule ("Numbers are allocated by the LifeOS lead only. Nobody
-- self-assigns"), this file lives OUTSIDE supabase/migrations/ so it can
-- never be mistaken for an applied or pending migration. File it as
-- supabase/migrations/<N>_mcp_scheduled_actions.sql once a number is
-- allocated, then delete this draft. (ALLOCATIONS.md shows `142` as next
-- free as of this writing -- not claimed, just noted.)
--
-- L7 (docs/ai-connector/PROGRAM-PLAN.md): the scheduling layer. One row per
-- deferred/recurring MCP write, fired by a pg_cron + pg_net poll (same proven
-- idiom as production's `dispatch-notifications-every-15min` and
-- app/api/cron/ping/route.ts) hitting a new Vercel route that reuses
-- lib/mcp/tool-wrapper.ts's `runMcpTool` -- the IDENTICAL code path and
-- audit logging a live call gets, never a parallel executor (the lead's
-- explicit, non-negotiable requirement #1).
--
-- `tool_name` CHECK is scoped to 'write' ONLY for this pass, deliberately --
-- see lib/scheduling/scheduler-core.ts's own header for why a scheduled
-- `read`/`list_capabilities`/`widget_manage` call is out of scope (no
-- delivery channel for the result today). Widening the CHECK later is a
-- plain, transactable ALTER; nothing about this schema assumes 'write' is
-- the only value forever.
--
-- `operation` IS A DISPLAY/LOG CONVENIENCE, NOT A SOURCE OF TRUTH -- always
-- recomputed fresh from `args` at fire time (resolveWriteOperation(args)),
-- the same function `write.ts` itself uses, never trusted stale from
-- creation time. Stored anyway so `scheduler_manage("list")` and
-- `mcp_audit_log` rows are readable without re-deriving it.
--
-- `token_id`'S SCOPE IS RE-CHECKED AT FIRE TIME, NEVER TRUSTED FROM
-- SCHEDULE TIME (requirement #2) -- the runner does a fresh, live lookup
-- (lib/mcp/tokens.ts's new `getLiveTokenById`) every firing, so a token
-- revoked after scheduling stops authorizing its own scheduled actions
-- immediately, the same firing cycle it would have run in. `ON DELETE
-- CASCADE` here only fires on an actual row DELETE (which nothing in this
-- codebase does to a token today -- tokens are revoked, never deleted); a
-- revoked-but-present token is exactly the case the fire-time check
-- exists for, and the scheduled row survives it (visible, auditable,
-- explicitly denied) rather than silently vanishing.
--
-- ONE-OFF XOR RECURRING, enforced by CHECK, not left to convention:
-- `run_at` (a single instant) and `cron_expression` (a restricted 5-field
-- "MM HH * * *|D" daily/weekly-at-local-time grammar -- see
-- lib/scheduling/cron.ts's own header for why NOT a full cron parser this
-- pass) are mutually exclusive, matching migration 108's own
-- nullable-XOR-discriminator idiom (`checkin_allocations.domain`/
-- `is_wasted`) rather than inventing a new pattern.
--
-- `next_run_at` IS THE POLL'S OWN QUERY TARGET (`status='active' AND
-- next_run_at <= now()`), computed at creation from `run_at`/
-- `cron_expression` and RECOMPUTED after every firing of a recurring
-- action -- a one-off's row transitions to `status='cancelled'` after its
-- single fire (see the runner's own header for why "cancelled" rather than
-- a fourth status: a completed one-off and a user-cancelled one-off are
-- both "will never fire again," which is the only fact `status` needs to
-- carry; `last_outcome` is where the real distinction -- did it actually
-- run, and how -- lives).
--
-- `attempt_count`/bounded retry (requirement #3): incremented on every
-- attempt (success or failure); a run of consecutive failures past
-- MAX_CONSECUTIVE_FAILURES (lib/mcp/scheduler-runner.ts) transitions
-- status to 'paused' rather than retrying forever -- a runaway loop
-- against a write surface is the worst failure mode this program has, and
-- 'paused' keeps the row visible via scheduler_manage("list") rather than
-- silently going quiet.
--
-- No begin;/commit; -- the runner (apply-migration.sh) owns the
-- transaction.

create table public.mcp_scheduled_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token_id uuid not null references public.mcp_access_tokens(id) on delete cascade,
  tool_name text not null check (tool_name in ('write')),
  operation text not null,
  args jsonb not null,
  cron_expression text,
  run_at timestamptz,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  last_outcome text check (last_outcome in ('ok', 'error', 'denied')),
  last_error text,
  attempt_count int not null default 0,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mcp_scheduled_actions_one_off_xor_recurring
    check ((cron_expression is not null and run_at is null) or (cron_expression is null and run_at is not null))
);

comment on table public.mcp_scheduled_actions is
  'L7: deferred/recurring MCP write actions, fired by a pg_cron+pg_net poll '
  'against app/api/cron/scheduled-actions/route.ts. Every firing re-checks '
  'the owning token''s live scope (never trusted from schedule time) and '
  'runs through the IDENTICAL runMcpTool/writeTool path and audit logging '
  'a live MCP call gets -- see lib/mcp/scheduler-runner.ts.';

comment on column public.mcp_scheduled_actions.operation is
  'Display/log convenience only -- recomputed fresh from args at fire time, never trusted stale.';

comment on column public.mcp_scheduled_actions.next_run_at is
  'What the poll queries against. Computed at creation, recomputed after every firing of a recurring action.';

create index mcp_scheduled_actions_user_id_idx on public.mcp_scheduled_actions (user_id);
create index mcp_scheduled_actions_token_id_idx on public.mcp_scheduled_actions (token_id);
-- Partial: the poll only ever looks at active, due rows -- a plain index
-- over the whole table (including every cancelled/paused row a busy
-- account accumulates) would grow unboundedly relative to what actually
-- gets queried.
create index mcp_scheduled_actions_due_idx on public.mcp_scheduled_actions (next_run_at) where status = 'active';

alter table public.mcp_scheduled_actions enable row level security;

create policy mcp_scheduled_actions_select_own on public.mcp_scheduled_actions
  for select using (user_id = (select auth.uid()));
create policy mcp_scheduled_actions_insert_own on public.mcp_scheduled_actions
  for insert with check (user_id = (select auth.uid()));
create policy mcp_scheduled_actions_update_own on public.mcp_scheduled_actions
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy mcp_scheduled_actions_delete_own on public.mcp_scheduled_actions
  for delete using (user_id = (select auth.uid()));

-- Reuses migration 074's existing touch_updated_at() -- ships with it from
-- the start (this table is genuinely mutated in place on every firing),
-- same discipline 141 (mcp_widgets) already followed rather than needing a
-- follow-up migration the way 133/135/136/137/138/139 did for tables that
-- shipped without one.
create trigger mcp_scheduled_actions_touch_updated_at
  before update on public.mcp_scheduled_actions for each row execute function public.touch_updated_at();

-- ==========================================================================
