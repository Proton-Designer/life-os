-- 217: OAuth hardening -- one serialized, atomic refresh grant (closes the
-- concurrent refresh-token reuse race), plus registration throttle support
-- and a stale-client prune function.
-- (P4-13, Team B overnight run 2026-09-15, builder p4-b-tokens, allocated by
-- tracking-app-a9.)
--
-- No existing function, view or trigger is replaced: every object below is
-- new, so there is no live pg_get_functiondef to diff against.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

------------------------------------------------------------------------------
-- 1. public.mcp_oauth_refresh_grant -- the whole refresh_token grant in ONE
--    transaction, serialized per (user_id, client_id).
------------------------------------------------------------------------------
-- WHY. Until now app/api/mcp/oauth/token/route.ts ran the refresh as a
-- sequence of separate PostgREST calls: rotate the refresh row, read the old
-- token's scopes, insert the new access token, re-point scheduled actions,
-- revoke the old token, insert the next refresh row. Reuse detection (a
-- replay of an already-rotated refresh token) was another sequence. Two
-- requests for the same (user, client) could interleave:
--
--   refresh R2:  rotate R2 ............ insert C ... insert R3
--   replay  R1:          reuse! read unused refresh rows (R3 not there yet)
--                        -> revokes nothing live -> C and R3 survive
--
-- The P4-11 security fix (d474729) closed the SEQUENTIAL version of this
-- (sibling refresh token revived a revoked chain); p4-b-tokens flagged this
-- concurrent one as still open. Locking only the rotate step cannot close it
-- -- an advisory xact lock is released when that one RPC's transaction ends,
-- and the mint/re-point would still run afterwards in other transactions.
-- The grant has to BE one transaction.
--
-- WHAT IT DOES, under pg_advisory_xact_lock('mcp_oauth_pair:<user>:<client>'):
--   * unknown hash                -> {outcome:'invalid'}          (nothing written)
--   * row already rotated (REUSE) -> burn every unused refresh row for the
--       pair, revoke the replayed row's access token AND every access token
--       those unused rows pointed at -> {outcome:'reuse'}  (committed: the
--       caller answers 400, but the revocation must stick)
--   * access token missing/revoked -> rotate (spend) the refresh row, mint
--       nothing -> {outcome:'revoked'}.  An EXPIRED-but-unrevoked token is
--       refreshable on purpose (P4-12: that is the normal OAuth path).
--   * otherwise -> rotate; revoke the old access token; insert the new one
--       (same scopes, client_kind 'mcp_oauth', caller's expires_at); move
--       mcp_scheduled_actions from old to new (P4-11 handoff, now atomic);
--       insert the next refresh row -> {outcome:'ok', ...}
--
-- REVOKE-BEFORE-INSERT is deliberate: the migration-215 live-token cap trigger
-- counts live rows, so replacing a token must not need a 21st slot. Nobody
-- outside this transaction can observe the moment in between.
--
-- If anything raises (cap trigger, FK, unique hash collision), the WHOLE grant
-- rolls back -- including the rotation -- so the client's refresh token is not
-- spent by a failure it didn't cause.
--
-- SECRETS NEVER ENTER SQL: the app generates the raw access/refresh tokens and
-- passes only their sha256 hex (and the access token's last4), exactly what the
-- tables store. SECURITY DEFINER + EXECUTE for service_role only (the token
-- endpoint's client); anon/authenticated can never call it.
create or replace function public.mcp_oauth_refresh_grant(
  p_refresh_token_hash text,
  p_new_access_token_hash text,
  p_new_access_token_last4 text,
  p_new_refresh_token_hash text,
  p_label text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.mcp_oauth_refresh_tokens%rowtype;
  v_old public.mcp_access_tokens%rowtype;
  v_live_ids uuid[];
  v_new_id uuid;
  v_burned integer;
  v_revoked integer;
  v_repointed integer;
begin
  if p_refresh_token_hash is null or p_new_access_token_hash is null or p_new_access_token_last4 is null
     or p_new_refresh_token_hash is null then
    raise exception 'mcp_oauth_refresh_grant: all token hashes are required' using errcode = '22023';
  end if;

  select * into v_row from public.mcp_oauth_refresh_tokens where token_hash = p_refresh_token_hash;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mcp_oauth_pair:' || v_row.user_id::text || ':' || v_row.client_id, 0)
  );

  -- Re-read under the lock: a concurrent grant for the same pair may have
  -- rotated this row (or burned it) while we waited.
  select * into v_row from public.mcp_oauth_refresh_tokens where id = v_row.id for update;

  if v_row.rotated_at is not null then
    select coalesce(pg_catalog.array_agg(r.access_token_id), '{}'::uuid[]) into v_live_ids
    from public.mcp_oauth_refresh_tokens r
    where r.user_id = v_row.user_id and r.client_id = v_row.client_id and r.rotated_at is null;

    update public.mcp_oauth_refresh_tokens r
    set rotated_at = pg_catalog.now()
    where r.user_id = v_row.user_id and r.client_id = v_row.client_id and r.rotated_at is null;
    get diagnostics v_burned = row_count;

    update public.mcp_access_tokens t
    set revoked_at = pg_catalog.now()
    where t.user_id = v_row.user_id
      and t.revoked_at is null
      and (t.id = v_row.access_token_id or t.id = any (v_live_ids));
    get diagnostics v_revoked = row_count;

    return pg_catalog.jsonb_build_object(
      'outcome', 'reuse', 'user_id', v_row.user_id, 'client_id', v_row.client_id,
      'burned_refresh_tokens', v_burned, 'revoked_access_tokens', v_revoked
    );
  end if;

  update public.mcp_oauth_refresh_tokens set rotated_at = pg_catalog.now() where id = v_row.id;

  select * into v_old
  from public.mcp_access_tokens t
  where t.id = v_row.access_token_id and t.user_id = v_row.user_id
  for update;

  if not found or v_old.revoked_at is not null or pg_catalog.cardinality(v_old.scopes) = 0 then
    return pg_catalog.jsonb_build_object('outcome', 'revoked', 'user_id', v_row.user_id, 'client_id', v_row.client_id);
  end if;

  update public.mcp_access_tokens set revoked_at = pg_catalog.now() where id = v_old.id;

  insert into public.mcp_access_tokens (user_id, token_hash, token_last4, label, scopes, expires_at, client_kind)
  values (v_row.user_id, p_new_access_token_hash, p_new_access_token_last4, p_label, v_old.scopes, p_expires_at, 'mcp_oauth')
  returning id into v_new_id;

  update public.mcp_scheduled_actions s
  set token_id = v_new_id
  where s.user_id = v_row.user_id and s.token_id = v_old.id;
  get diagnostics v_repointed = row_count;

  insert into public.mcp_oauth_refresh_tokens (token_hash, access_token_id, client_id, user_id)
  values (p_new_refresh_token_hash, v_new_id, v_row.client_id, v_row.user_id);

  return pg_catalog.jsonb_build_object(
    'outcome', 'ok', 'user_id', v_row.user_id, 'client_id', v_row.client_id,
    'access_token_id', v_new_id, 'scopes', pg_catalog.to_jsonb(v_old.scopes),
    'repointed_scheduled_actions', v_repointed
  );
end;
$$;

revoke all on function public.mcp_oauth_refresh_grant(text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.mcp_oauth_refresh_grant(text, text, text, text, text, timestamptz) to service_role;

comment on function public.mcp_oauth_refresh_grant(text, text, text, text, text, timestamptz) is
  'P4-13: the OAuth refresh_token grant as ONE transaction serialized per (user_id, client_id): '
  'reuse detection (burn unused refresh rows + revoke live tokens), refusal for a revoked access '
  'token, or rotate + revoke old + mint new + re-point scheduled actions + next refresh row. '
  'Hashes only, never raw secrets. service_role only. Caller: app/api/mcp/oauth/token/route.ts.';

------------------------------------------------------------------------------
-- 2. Registration throttle support: which (hashed) IP registered a client.
------------------------------------------------------------------------------
-- The global 50-client cap (lib/mcp/oauth.ts MAX_REGISTERED_CLIENTS) let any
-- stranger lock every account out of connecting a new OAuth client (prod was
-- already 24/50 from one account's testing). It is replaced by a per-IP limit
-- counted from this column over the trailing hour.
--
-- HMAC, NEVER THE RAW IP: the app stores HMAC-SHA256(server secret, ip). An
-- unkeyed hash of an IPv4 address is reversible by enumeration; a keyed one
-- is not without the server secret. The prune function below nulls it after
-- 24h anyway -- it only exists to count the last hour.
alter table public.mcp_oauth_clients
  add column if not exists registration_ip_hash text;

create index if not exists mcp_oauth_clients_registration_ip_hash_created_at_idx
  on public.mcp_oauth_clients (registration_ip_hash, created_at desc)
  where registration_ip_hash is not null;

comment on column public.mcp_oauth_clients.registration_ip_hash is
  'HMAC-SHA256 of the registering client IP (never the raw IP), used only to limit dynamic client '
  'registrations per IP per hour. Nulled after 24h by mcp_oauth_prune_stale_clients().';

------------------------------------------------------------------------------
-- 3. public.mcp_oauth_prune_stale_clients -- keeps the table bounded without
--    a global cap.
------------------------------------------------------------------------------
-- Deletes DCR clients older than 24h that were never used: no authorization
-- code and no refresh token reference them. CONSERVATIVE BY DESIGN: because
-- both children are required to be absent, the `on delete cascade` FKs from
-- mcp_oauth_codes / mcp_oauth_refresh_tokens (132) can never fire, so this
-- never deletes a row owned by any user -- only anonymous registrations.
-- Residual (accepted): a client that got a code but never exchanged it is
-- kept forever (its expired code row still references it). Widening that is a
-- separate decision because it would cascade into user-owned code rows.
--
-- Scheduling it is an OPERATOR action, not part of this file (house rule,
-- see 166's header and ALLOCATIONS.md "Operator actions on production"):
--   select cron.schedule('mcp-oauth-prune-stale-clients-hourly', '23 * * * *',
--                        'select public.mcp_oauth_prune_stale_clients()');
create or replace function public.mcp_oauth_prune_stale_clients()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.mcp_oauth_clients c
  where c.created_at < pg_catalog.now() - interval '24 hours'
    and not exists (select 1 from public.mcp_oauth_codes k where k.client_id = c.client_id)
    and not exists (select 1 from public.mcp_oauth_refresh_tokens r where r.client_id = c.client_id);
  get diagnostics v_deleted = row_count;

  update public.mcp_oauth_clients
  set registration_ip_hash = null
  where registration_ip_hash is not null
    and created_at < pg_catalog.now() - interval '24 hours';

  return v_deleted;
end;
$$;

revoke all on function public.mcp_oauth_prune_stale_clients() from public, anon, authenticated;
grant execute on function public.mcp_oauth_prune_stale_clients() to service_role;

comment on function public.mcp_oauth_prune_stale_clients() is
  'P4-13: deletes never-used DCR clients (no codes, no refresh tokens) older than 24h and nulls '
  'registration_ip_hash older than 24h. Never cascades into user-owned rows. Returns rows deleted. '
  'Scheduled hourly by an operator-registered pg_cron job.';

------------------------------------------------------------------------------
-- Verification (read-only, after apply):
--   select proname, prosecdef, proconfig from pg_proc
--    where proname in ('mcp_oauth_refresh_grant','mcp_oauth_prune_stale_clients');
--   select has_function_privilege('authenticated', 'public.mcp_oauth_refresh_grant(text,text,text,text,text,timestamptz)', 'execute'),  -- f
--          has_function_privilege('anon',          'public.mcp_oauth_prune_stale_clients()', 'execute');                               -- f
--   select count(*) filter (where registration_ip_hash is not null) from public.mcp_oauth_clients;  -- 0 right after apply
------------------------------------------------------------------------------
