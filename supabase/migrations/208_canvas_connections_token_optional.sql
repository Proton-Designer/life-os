-- 208: canvas_connections' token fields become optional (CANVAS-GAP-06,
-- Sonnet ENG 1, allocated by Opus Lead).
--
-- ENG3's live-verify of CANVAS-LITE-04's own "ICS-alone" acceptance
-- criterion found that a genuinely no-token account (the user's own
-- situation -- their school blocks Canvas access tokens) can NEVER save a
-- Canvas calendar-feed URL: saveCanvasIcsFeedUrl refuses when no
-- canvas_connections row exists, and the ONLY writer that ever creates
-- that row is connectCanvas, which hard-requires a token. The Settings
-- copy promises the ICS path "works whether or not your school allows
-- access tokens" -- that promise did not hold.
--
-- The Server Action's own guard was one layer too shallow: instance_url/
-- encrypted_token/token_last4 were NOT NULL at the table level (migration
-- 210), so a token-less row was unrepresentable in the schema itself, not
-- just refused by the action. This migration relaxes those three (plus
-- token_status, whose own NOT NULL DEFAULT 'ok' would otherwise claim a
-- healthy token exists on a row that has none) to nullable, and adds a
-- CHECK so the four token-identity columns can only ever be ALL present
-- (a real token connection) or ALL absent (ICS-feed-only, or a brand-new
-- row with neither yet) -- never a half state some later reader could
-- trust by accident (Opus Lead's own condition on this migration).
--
-- token_status's DEFAULT is dropped, not just its NOT NULL: connectCanvas
-- already sets `token_status: "ok"` explicitly in its own upsert payload
-- (app/(app)/settings/canvas-actions.ts), so removing the column default
-- changes no real behavior there -- it only stops a token-less insert from
-- silently claiming "ok" for a token that was never connected.
--
-- Every reader of these columns was checked before this migration
-- (app/(app)/settings/canvas-actions.ts, lib/canvas/connection-core.ts,
-- lib/canvas/sync-core.ts, app/api/cron/canvas-sync/route.ts): the cron
-- sync's own `.eq("token_status","ok")` filter and sync-core.ts's own
-- `connectedAndUsable()` gate (`token_status === "ok"`) already exclude a
-- null-token row for free (SQL/PostgREST `.eq()` against NULL never
-- matches) -- only lib/canvas/connection-core.ts's
-- `resolveCanvasConnectionCore` and
-- app/(app)/settings/canvas-actions.ts's `getCanvasConnectionStatus`
-- needed an app-code fix (same commit as this migration's application, a
-- separate commit per this program's migration-then-code ordering rule).
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

alter table public.canvas_connections
  alter column instance_url drop not null,
  alter column encrypted_token drop not null,
  alter column token_last4 drop not null,
  alter column token_status drop not null,
  alter column token_status drop default;

alter table public.canvas_connections
  add constraint canvas_connections_token_fields_all_or_nothing
  check (
    (instance_url is null and encrypted_token is null and token_last4 is null and token_status is null)
    or
    (instance_url is not null and encrypted_token is not null and token_last4 is not null and token_status is not null)
  );

comment on constraint canvas_connections_token_fields_all_or_nothing on public.canvas_connections is
  'CANVAS-GAP-06: instance_url/encrypted_token/token_last4/token_status are '
  'a single unit -- a real Canvas API token connection -- and can only be '
  'all-present or all-absent. A row with only the encrypted_ics_feed_url* '
  'columns set (added by migration 195) is a valid, token-less ICS-only '
  'connection; connectCanvas''s own upsert always supplies all four '
  'together, so a real token connection never violates this.';
