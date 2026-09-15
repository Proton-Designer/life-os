-- 212: scope mcp_audit_log_token_same_user's ON DELETE SET NULL to token_id.
-- (P4-10, Team B overnight run 2026-09-15, tracking-app-a9.)
--
-- 150 converted mcp_audit_log.token_id to a composite tenancy FK but kept an
-- UNQUALIFIED `on delete set null`. On a composite key that nulls EVERY
-- referencing column -- including mcp_audit_log.user_id, which is NOT NULL --
-- so deleting any mcp_access_tokens row that has audit rows raises a not-null
-- violation instead of detaching the audit history. Same trap 129/140 fixed
-- for eighteen other FKs; this one arrived after that sweep.
--
-- Not live-triggered today (no code path deletes mcp_access_tokens --
-- revocation stamps revoked_at), but P4's token lifecycle work makes a real
-- delete path plausible, and it would fail on the first token that was ever
-- used.
--
-- Fix is 129's: `on delete set null (token_id)`. Do NOT relax user_id's NOT
-- NULL -- an audit row owned by nobody is invisible to its select-only RLS
-- policy and would silently vanish from the subject's own audit view.
--
-- Production sweep before writing (composite FKs whose definition ends in an
-- unscoped `ON DELETE SET NULL`): exactly one row, this constraint. After
-- apply the same sweep returns zero rows.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction, so the drop
-- and re-add are atomic.

alter table public.mcp_audit_log
  drop constraint mcp_audit_log_token_same_user;

alter table public.mcp_audit_log
  add constraint mcp_audit_log_token_same_user
  foreign key (user_id, token_id) references public.mcp_access_tokens (user_id, id)
  on delete set null (token_id);
