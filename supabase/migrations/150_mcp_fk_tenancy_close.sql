-- 150 -- allocated by the LifeOS lead 2026-09-13. Staged first as a draft
-- outside supabase/migrations/ pending that allocation, same discipline as
-- 132/134 ("correctly did NOT self-assign a number").
--
-- Close the four single-column FKs to user-scoped parents that
-- check-fk-tenancy.sh has been reporting since the MCP tables shipped (130,
-- 132, 142, 145) -- invisible until now because the script could not run on
-- this machine (no psql; see E1's tooling fix, same session). Same class as
-- 058/086/100/101: a squat on the parent by user A, satisfied at the FK
-- level and at the RLS `with check` level, permanently and invisibly locks
-- user B out of a row they should own. Port 100/101's exact pattern --
-- composite FK (user_id, child_col) -> parent(user_id, id) -- nothing new
-- invented.
--
-- SCOPE, VERIFIED LIVE AGAINST PRODUCTION BEFORE WRITING THIS (2026-09-13):
--   mcp_audit_log.token_id             -> mcp_access_tokens    (nullable,  ON DELETE SET NULL)
--   mcp_oauth_refresh_tokens.access_token_id -> mcp_access_tokens (NOT NULL, ON DELETE CASCADE)
--   mcp_scheduled_actions.token_id     -> mcp_access_tokens    (NOT NULL,  ON DELETE CASCADE)
--   mcp_notification_dispatch_log.scheduled_action_id -> mcp_scheduled_actions (NOT NULL, ON DELETE CASCADE)
--
-- All four child tables ALREADY carry `user_id uuid not null` (added at
-- table creation in 130/132/142/145) -- unlike some 058-era pairs, there is
-- no column to add and no backfill of a new column. What's missing is (a) a
-- composite unique target on each parent and (b) the composite FK itself.
--
-- CROSS-TENANT AUDIT, run against production immediately before writing this
-- file (read-only, see E1's report): mcp_oauth_refresh_tokens, mcp_scheduled_actions
-- and mcp_notification_dispatch_log all have ZERO rows today, so there is no
-- existing row to check in those three. mcp_audit_log has 52 rows, 13 with a
-- non-null token_id; joining every one of those 13 against its token's
-- owner found ZERO mismatches -- no row in this schema is already
-- cross-tenant. This migration NARROWS every FK (any row satisfying the new
-- composite key already satisfied the old one), so it fails loudly rather
-- than silently accepting a violation if that changes before this applies.
--
-- TWO-LEVEL CHAIN -- ORDER MATTERS. mcp_scheduled_actions is both a CHILD of
-- mcp_access_tokens (via token_id) and the PARENT of
-- mcp_notification_dispatch_log (via scheduled_action_id). Its own
-- (user_id, id) composite unique target is created in this file BEFORE
-- mcp_notification_dispatch_log's composite FK is added against it, and
-- mcp_scheduled_actions's own composite FK to mcp_access_tokens is converted
-- first -- so by the time anything references mcp_scheduled_actions(user_id,
-- id), that table's own tenancy is already closed. All of this is one
-- transaction (the runner's --single-transaction), so this ordering is
-- enforced by the file, not by hoping two migrations apply in sequence.
--
-- DELETE SEMANTICS READ FROM pg_constraint, NOT ASSUMED (100/101's rule):
-- SET NULL preserved for mcp_audit_log.token_id (nullable column, MATCH
-- SIMPLE leaves any future NULL-token audit rows unchecked, same as before);
-- CASCADE preserved for the other three (all NOT NULL).
--
-- COLUMN ORDER IS (user_id, id) AND MUST MATCH THE PARENT INDEX EXACTLY --
-- 097's lesson, restated in 100's own header.

-- ---------------------------------------------------------------------------
-- 1. Composite-FK targets on the parents. `id` is already the primary key on
--    both, so these add no new uniqueness -- they exist solely to be
--    referenced by a composite FK.
-- ---------------------------------------------------------------------------
create unique index if not exists mcp_access_tokens_user_id_id_key    on public.mcp_access_tokens (user_id, id);
create unique index if not exists mcp_scheduled_actions_user_id_id_key on public.mcp_scheduled_actions (user_id, id);

-- ---------------------------------------------------------------------------
-- 2. mcp_access_tokens's three direct children.
-- ---------------------------------------------------------------------------

-- mcp_audit_log.token_id -- nullable, ON DELETE SET NULL. Append-only,
-- select-only RLS (mcp_audit_log_select_own is the ONLY policy on this
-- table -- confirmed live). This migration touches ONLY the FK constraint;
-- it adds no column, no trigger, no policy, so the select-only /
-- no-update-no-delete property of the table is untouched.
alter table public.mcp_audit_log drop constraint if exists mcp_audit_log_token_id_fkey;
alter table public.mcp_audit_log add constraint mcp_audit_log_token_same_user
  foreign key (user_id, token_id) references public.mcp_access_tokens (user_id, id) on delete set null;

-- mcp_oauth_refresh_tokens.access_token_id -- NOT NULL, ON DELETE CASCADE.
alter table public.mcp_oauth_refresh_tokens drop constraint if exists mcp_oauth_refresh_tokens_access_token_id_fkey;
alter table public.mcp_oauth_refresh_tokens add constraint mcp_oauth_refresh_tokens_token_same_user
  foreign key (user_id, access_token_id) references public.mcp_access_tokens (user_id, id) on delete cascade;

-- mcp_scheduled_actions.token_id -- NOT NULL, ON DELETE CASCADE. Converted
-- BEFORE mcp_notification_dispatch_log below, per the chain note above.
alter table public.mcp_scheduled_actions drop constraint if exists mcp_scheduled_actions_token_id_fkey;
alter table public.mcp_scheduled_actions add constraint mcp_scheduled_actions_token_same_user
  foreign key (user_id, token_id) references public.mcp_access_tokens (user_id, id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 3. mcp_scheduled_actions's one child. Depends on step 1's
--    mcp_scheduled_actions_user_id_id_key existing, which it now does.
-- ---------------------------------------------------------------------------
alter table public.mcp_notification_dispatch_log drop constraint if exists mcp_notification_dispatch_log_scheduled_action_id_fkey;
alter table public.mcp_notification_dispatch_log add constraint mcp_notification_dispatch_log_scheduled_action_same_user
  foreign key (user_id, scheduled_action_id) references public.mcp_scheduled_actions (user_id, id) on delete cascade;

-- ---------------------------------------------------------------------------
-- VERIFICATION (read-only, safe to run every time, mirrors check-fk-tenancy.sh's
-- own query so a green here predicts a green there before it's re-run for real).
-- ---------------------------------------------------------------------------
-- select c.conrelid::regclass::text||'.'||a.attname||' -> '||c.confrelid::regclass::text
--   from pg_constraint c
--   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
--  where c.contype = 'f'
--    and c.connamespace = 'public'::regnamespace
--    and array_length(c.conkey, 1) = 1
--    and c.confrelid::regclass::text <> 'users'
--    and exists (select 1 from pg_attribute p
--                 where p.attrelid = c.confrelid and p.attname = 'user_id' and not p.attisdropped)
--    and c.conrelid::regclass::text in ('mcp_audit_log','mcp_notification_dispatch_log','mcp_oauth_refresh_tokens','mcp_scheduled_actions');
-- Expected after this migration: zero rows for these four tables.
