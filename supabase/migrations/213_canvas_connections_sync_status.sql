-- 213: sync status columns on canvas_connections (P2-22, Team B, builds on
-- migration 210). Additive only -- no new table, no new FK, so no
-- composite-tenancy consideration beyond what 210 already established.
--
-- token_status distinguishes "Canvas rejected this token" (needs the user
-- to paste a new one) from every other kind of sync failure (network
-- blip, Canvas maintenance, an SSRF-guard rejection) -- those don't mean
-- the credential is bad, so they must not flip this to 'expired' and send
-- the user down a reconnect flow for a problem a retry would fix.
--
-- last_synced_at / last_sync_error are both nullable: a connection that
-- has never been synced (just connected, "Sync courses" not clicked yet)
-- is a normal, expected state, not an error -- never defaulted to now()/''
-- which would fabricate a sync that didn't happen (same reasoning
-- migration 146's own header gives for not stamping updated_at with the
-- migration's own timestamp).
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

alter table public.canvas_connections
  add column token_status text not null default 'ok' check (token_status in ('ok', 'expired')),
  add column last_synced_at timestamptz null,
  add column last_sync_error text null;

comment on column public.canvas_connections.token_status is
  '''ok'' or ''expired''. Set to ''expired'' only when Canvas itself rejects '
  'the token (HTTP 401/403) -- lib/canvas/client.ts''s authExpired flag, not '
  'any other fetch failure (network, timeout, SSRF-guard rejection). Reset '
  'to ''ok'' on every successful (re)connect. Drives the Settings > Canvas '
  'panel''s reconnect-vs-sync UI state.';

comment on column public.canvas_connections.last_sync_error is
  'Human-readable message from the most recent sync attempt, of any kind '
  '(not only auth failures). Cleared to null on the next successful sync. '
  'Never shown as a reason to auto-disconnect -- purely informational.';
