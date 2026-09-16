-- 209: outbound webhooks, vertical slice for ONE event type (P4-22, Sonnet
-- ENG 1, allocated by Opus Lead). Scoped down from the task's full AC
-- (Opus Lead, ~03:56): "build a vertical slice that genuinely works end to
-- end for ONE event type (a write succeeding is the obvious one) rather
-- than broad half-coverage." `event` is therefore a single CHECK-
-- constrained scalar, not an array of many kinds -- widening it to more
-- event types is a later migration's job, not speculative columns here.
--
-- encrypted_secret, NOT a hash: unlike a bearer token (verified by
-- hash-compare, mcp_access_tokens.token_hash), an HMAC signature needs the
-- RAW secret bytes at delivery time to compute the signature -- the same
-- reversible-encryption posture canvas_connections.encrypted_token already
-- uses (lib/ai/encryption.ts, AES-256-GCM). Shown to the owner exactly
-- once, at creation; secret_last4 is what the UI displays afterward.
--
-- mcp_webhook_deliveries is the queue the AC calls for ("a row + cron/
-- pg_net drain, not inline in the request") -- dispatch never happens
-- synchronously inside the write call that triggered it. user_id is
-- denormalized here (copied from the owning webhook at enqueue time by
-- application code, never user-supplied) so RLS can scope deliveries
-- directly without a join, and so a webhook's own deletion (cascade) is
-- the only thing that can ever remove a user's delivery history.
--
-- RLS is deliberately narrow: users get select+insert+delete on
-- mcp_webhooks (create, list, remove) and select-only on deliveries (read
-- status/history) -- never update. failure_count/active/last_delivery_*/
-- delivery status are ALL written by the service-role dispatch job only
-- (which bypasses RLS entirely), never by the owning user directly -- a
-- user cannot forge a delivered status or reset their own failure_count.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

create table public.mcp_webhooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url text not null check (url ~ '^https://'),
  encrypted_secret text not null,
  secret_last4 text not null check (length(secret_last4) <= 8),
  event text not null default 'write.ok' check (event = 'write.ok'),
  active boolean not null default true,
  failure_count int not null default 0,
  last_delivery_at timestamptz null,
  last_delivery_status text null check (last_delivery_status in ('ok', 'failed')),
  last_delivery_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mcp_webhooks_user_id_idx on public.mcp_webhooks (user_id);
-- Drain query shape: active webhooks only, repeatedly, from the dispatch job.
create index mcp_webhooks_active_idx on public.mcp_webhooks (active) where active;

alter table public.mcp_webhooks enable row level security;

create policy "mcp_webhooks_select_own" on public.mcp_webhooks
  for select using (user_id = (select auth.uid()));
create policy "mcp_webhooks_insert_own" on public.mcp_webhooks
  for insert with check (user_id = (select auth.uid()));
create policy "mcp_webhooks_delete_own" on public.mcp_webhooks
  for delete using (user_id = (select auth.uid()));

comment on table public.mcp_webhooks is
  'P4-22 vertical slice: one outbound webhook per row, ONE event type '
  '(write.ok) for now. encrypted_secret is reversible (AES-256-GCM via '
  'lib/ai/encryption.ts) because HMAC signing needs the raw secret at '
  'delivery time -- never selected into anything that reaches a browser. '
  'active/failure_count/last_delivery_* are written ONLY by the '
  'service-role dispatch job (lib/mcp/webhook-dispatch.ts), never by the '
  'owning user -- no update RLS policy exists for this table.';

comment on column public.mcp_webhooks.encrypted_secret is
  'AES-256-GCM, stored as iv:authTag:ciphertext in base64 (lib/ai/encryption.ts). '
  'NEVER select this column into anything that reaches a Client Component. '
  'Shown to the owner in plaintext exactly once, at creation.';

create table public.mcp_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.mcp_webhooks (id) on delete cascade,
  -- Denormalized from mcp_webhooks.user_id at enqueue time (application
  -- code, service-role) -- never user-supplied -- so RLS can scope this
  -- table directly without a join back to mcp_webhooks.
  user_id uuid not null references auth.users (id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempt_count int not null default 0,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now()
);

create index mcp_webhook_deliveries_user_id_idx on public.mcp_webhook_deliveries (user_id, created_at desc);
-- Drain query shape: pending deliveries whose retry time has arrived.
create index mcp_webhook_deliveries_pending_idx on public.mcp_webhook_deliveries (next_attempt_at) where status = 'pending';

alter table public.mcp_webhook_deliveries enable row level security;

create policy "mcp_webhook_deliveries_select_own" on public.mcp_webhook_deliveries
  for select using (user_id = (select auth.uid()));

comment on table public.mcp_webhook_deliveries is
  'P4-22: the delivery queue the dispatch job (lib/mcp/webhook-dispatch.ts, '
  'piggybacked on the existing 5-minute scheduled-actions cron poll -- no '
  'new pg_cron registration needed) drains. A row is enqueued by '
  'application code right after a successful audited write '
  '(lib/agent-api/execute.ts), never delivered inline in that request. '
  'No insert/update RLS policy for the user -- the service-role dispatch '
  'job is the only writer of status/attempt_count/next_attempt_at.';
