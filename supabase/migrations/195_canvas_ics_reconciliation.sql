-- 195: ICS calendar-feed reconciliation columns on canvas_connections
-- (P3-13, Sonnet ENG 1). Additive only -- no new table, no new FK.
--
-- Canvas's per-user ICS calendar feed URL is a SEPARATE credential from
-- the API personal-access-token already stored in `encrypted_token`: it's
-- a secret bearer token embedded directly in the URL's query string
-- (Canvas's own "Calendar Feed" link), not the OAuth-like PAT the REST
-- sync uses. Encrypted at rest via the SAME encryptSecret/decryptSecret
-- helpers (lib/ai/encryption.ts) `encrypted_token` already uses -- per
-- the Lead's explicit ruling, this is a credential: never returned to the
-- client, never sent to MCP, never logged.
--
-- ics_feed_url_last4 mirrors token_last4's own purpose: lets the Settings
-- UI show "feed connected" without ever reading the decrypted secret back.
--
-- last_ics_reconcile_at is a plain cooldown timestamp for the manually-
-- triggered "Reconcile now" action (the Lead's ruling: rate-limit it,
-- since an ICS feed is a full-term dump, not a small incremental poll) --
-- nullable: a connection whose feed URL was just saved and never
-- reconciled yet is a normal, expected state, not an error, matching
-- migration 213's own reasoning for last_synced_at being nullable.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

alter table public.canvas_connections
  add column encrypted_ics_feed_url text null,
  add column ics_feed_url_last4 text null,
  add column last_ics_reconcile_at timestamptz null;

comment on column public.canvas_connections.encrypted_ics_feed_url is
  'Encrypted Canvas ICS calendar-feed URL (a bearer secret in URL form, '
  'per-user, separate from encrypted_token). Never returned to the '
  'client or to MCP, never logged. Null when the user has not opted into '
  'ICS reconciliation.';

comment on column public.canvas_connections.ics_feed_url_last4 is
  'Last 4 characters of the feed URL''s own embedded secret token, for a '
  '"feed connected" UI indicator only -- mirrors token_last4''s purpose '
  'for encrypted_token.';

comment on column public.canvas_connections.last_ics_reconcile_at is
  'Timestamp of the most recent manual "Reconcile now" run, for a simple '
  'per-user cooldown (the ICS feed is a full-term dump, not an '
  'incremental poll). Null until the first run.';
