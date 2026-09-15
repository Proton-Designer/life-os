-- 215: MCP token lifecycle -- expiry, client kind, per-user live-token cap,
-- and the transport each audited call arrived on.
-- (P4-12, Team B overnight run 2026-09-15, builder p4-b-tokens, allocated by
-- tracking-app-a9.)
--
-- WHY. Until now revocation was the ONLY way an mcp_access_tokens row ever
-- died (130's header; the token route's own "no expires_in" note). Four gaps
-- this closes, all found in the P4 audit (accounts-and-infra.md Q3, task 11):
--   1. A leaked PAT or OAuth token lived forever unless the owner noticed.
--   2. OAuth responses carried no expires_in, so no client ever refreshed on
--      a timer -- the rotation machinery (132) was effectively dead code.
--   3. Nothing distinguished a Settings PAT from an OAuth-minted token from a
--      future REST agent token except a free-text label.
--   4. A user could mint unlimited tokens, multiplying the per-token rate
--      limit (rate-limit.ts keys on token_id) by however many they made.
-- Plus the audit log could not say whether a call came over MCP, the coming
-- REST adapter (P4-17), or the scheduler.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

------------------------------------------------------------------------------
-- 1. expires_at -- NULL means "never", which every existing row keeps.
------------------------------------------------------------------------------
-- Enforcement lives in lib/mcp/tokens.ts (verifyAccessToken for live calls,
-- getLiveTokenById for scheduled fires): a row with expires_at <= now() is
-- treated exactly like a revoked one. The CHECK only rules out a token that
-- is born already expired -- that is always a bug, never a choice.
--
-- No expiry backfill, deliberately: the acceptance criteria say existing
-- null-expiry tokens are unaffected, and silently expiring someone's working
-- connector at deploy time would be the worst way to introduce this.
alter table public.mcp_access_tokens
  add column if not exists expires_at timestamptz;

alter table public.mcp_access_tokens
  add constraint mcp_access_tokens_expires_after_created
  check (expires_at is null or expires_at > created_at);

comment on column public.mcp_access_tokens.expires_at is
  'When this token stops working on its own. NULL = never (Settings "never", and every token '
  'created before migration 215). Checked at every verification (lib/mcp/tokens.ts '
  'verifyAccessToken / getLiveTokenById) exactly like revoked_at. OAuth-minted tokens get '
  'now()+30 days and the token response reports expires_in.';

------------------------------------------------------------------------------
-- 2. client_kind -- what minted the token, as a closed vocabulary.
------------------------------------------------------------------------------
--   pat        Settings "Create token" (the default, and every pre-215 row not
--              identified below)
--   mcp_oauth  minted by /api/mcp/oauth/token (authorization_code or refresh)
--   agent      reserved for the REST agent API (P4-17); nothing writes it yet.
--              Declared now so P4-17 needs no second migration on this table.
alter table public.mcp_access_tokens
  add column if not exists client_kind text not null default 'pat';

alter table public.mcp_access_tokens
  add constraint mcp_access_tokens_client_kind_check
  check (client_kind in ('pat', 'mcp_oauth', 'agent'));

-- Backfill. The OAuth route has only ever labelled its tokens via
-- formatOAuthTokenLabel (lib/mcp/oauth.ts), whose ONLY output shape is
-- 'OAuth: <client_name | unnamed connector>'. A refresh-token row pointing at
-- the token is an independent second signal (production has 0 such rows
-- today, so the label is the one doing the work). Residual risk, accepted: a
-- user who hand-named a Settings PAT "OAuth: something" is classified
-- mcp_oauth -- harmless, since client_kind grants nothing by itself.
update public.mcp_access_tokens t
set client_kind = 'mcp_oauth'
where t.client_kind = 'pat'
  and (
    t.label like 'OAuth: %'
    or exists (select 1 from public.mcp_oauth_refresh_tokens r where r.access_token_id = t.id)
  );

comment on column public.mcp_access_tokens.client_kind is
  'What minted this token: pat (Settings), mcp_oauth (OAuth token endpoint), agent (REST agent '
  'API, P4-17). Descriptive only -- scopes still decide what a token may do.';

------------------------------------------------------------------------------
-- 3. Per-user cap: at most 20 LIVE tokens (not revoked, not expired).
------------------------------------------------------------------------------
-- Enforced in the database, not only in createAccessToken, because the app
-- path is not the only insert path: 130's mcp_access_tokens_insert_own policy
-- lets any signed-in user INSERT through PostgREST with their own session,
-- and an app-side count-then-insert races two concurrent creates past the
-- limit. The app still checks first so the common case gets a friendly
-- message; this trigger is the guarantee.
--
-- The per-user advisory lock serialises concurrent inserts FOR THE SAME USER
-- ONLY (transaction-scoped, released at commit/rollback), so the count cannot
-- be raced. SECURITY INVOKER: under a user's JWT RLS already limits the count
-- to their own rows; under service role (OAuth route) the explicit user_id
-- filter does the same. The message prefix 'mcp_token_cap:' is matched by
-- lib/mcp/tokens.ts to show a clean error -- change both together.
--
-- 20 is duplicated in lib/mcp/tokens.ts (MAX_LIVE_TOKENS_PER_USER); change
-- both together. Revoked and expired rows never count, so a user at the cap
-- frees a slot by revoking one in Settings.
--
-- OAuth refresh (token route) inserts the new token BEFORE revoking the old
-- one, so a user at exactly 20 live tokens cannot refresh an OAuth
-- connection until they revoke something. Accepted and reported by the app
-- as the same clear cap error rather than silently over-issuing.
create or replace function public.mcp_access_tokens_enforce_live_cap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  live_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mcp_access_tokens_cap:' || new.user_id::text, 0));

  select count(*) into live_count
  from public.mcp_access_tokens t
  where t.user_id = new.user_id
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > pg_catalog.now());

  if live_count >= 20 then
    raise exception 'mcp_token_cap: this account already has % live tokens (limit 20). Revoke one in Settings before creating another.', live_count
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.mcp_access_tokens_enforce_live_cap() from public, anon, authenticated;

drop trigger if exists mcp_access_tokens_enforce_live_cap on public.mcp_access_tokens;
create trigger mcp_access_tokens_enforce_live_cap
  before insert on public.mcp_access_tokens
  for each row execute function public.mcp_access_tokens_enforce_live_cap();

------------------------------------------------------------------------------
-- 4. mcp_audit_log.transport -- which door the call came through.
------------------------------------------------------------------------------
--   mcp        /api/mcp (every pre-215 row: the only transport that existed)
--   rest       REST agent API (P4-17)
--   scheduler  lib/mcp/scheduler-runner.ts fires, incl. its fire-time denials
-- Existing rows take the default, which is correct: mcp_scheduled_actions has
-- never held a row in production, and REST does not exist yet. The audit log
-- stays insert-only for service role (130); this adds no policy.
alter table public.mcp_audit_log
  add column if not exists transport text not null default 'mcp';

alter table public.mcp_audit_log
  add constraint mcp_audit_log_transport_check
  check (transport in ('mcp', 'rest', 'scheduler'));

comment on column public.mcp_audit_log.transport is
  'Which transport the audited call arrived on: mcp (/api/mcp), rest (agent REST API, P4-17), '
  'scheduler (scheduled-action fire). Set by writeAuditRow''s caller (lib/mcp/audit.ts).';

------------------------------------------------------------------------------
-- Verification (read-only, run after apply):
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema='public'
--      and (table_name, column_name) in (('mcp_access_tokens','expires_at'),
--          ('mcp_access_tokens','client_kind'), ('mcp_audit_log','transport'));
--   select client_kind, count(*), count(*) filter (where label like 'OAuth: %')
--     from public.mcp_access_tokens group by 1;   -- expect every 'OAuth: %' row = mcp_oauth
--   select transport, count(*) from public.mcp_audit_log group by 1;  -- expect all 'mcp'
--   select tgname from pg_trigger where tgrelid = 'public.mcp_access_tokens'::regclass and not tgisinternal;
-- Positive control for the cap (rolled back, test account only):
--   begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<test uid>"}';
--   insert 20 live rows -> ok; 21st -> ERROR mcp_token_cap; revoke one; insert -> ok; rollback;
------------------------------------------------------------------------------
