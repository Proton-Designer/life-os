-- 220: atomic rate-limit buckets for the agent surface (MCP + REST + scheduler)
-- and auth-failure throttling.
-- (P4-14, Team B overnight run 2026-09-15, builder p4-b-tokens, allocated by
-- tracking-app-a9.)
--
-- No existing function, view or trigger is replaced: every object below is
-- new, so there is no live pg_get_functiondef to diff against.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

------------------------------------------------------------------------------
-- WHY (lib/mcp/rate-limit.ts before this migration)
------------------------------------------------------------------------------
-- The limiter counted a token's mcp_audit_log rows over the trailing 60s, then
-- let the call run. Four problems (P4 audit accounts-and-infra.md #7):
--   * count-then-act: a parallel burst all pass the count before any of their
--     audit rows land -> far more than 30 calls through.
--   * denied calls write audit rows, so they count: a retrying client stays
--     locked out by its own denials.
--   * per token only: N tokens = N x the budget.
--   * scheduled fires share the interactive budget, so a busy session makes
--     scheduled writes fail (5 failures pause them).
--
-- THE FIX: a dedicated counter the limiter owns, consumed atomically.

------------------------------------------------------------------------------
-- 1. public.mcp_rate_limit_buckets -- fixed-window hit counters.
------------------------------------------------------------------------------
-- bucket_key examples (built by lib/mcp/rate-limit.ts; opaque to SQL):
--   tok:<token_id>        interactive calls per token (MCP + REST share it)
--   user:<user_id>        interactive calls per user, across all tokens
--   sched-tok:<token_id>  scheduled fires per token (separate budget)
--   sched-user:<user_id>  scheduled fires per user
--   authfail:<hmac(ip)>   failed authentications per client IP (never the raw IP)
-- Service-role only: RLS on with no policies, and no grants to anon/authenticated.
create table if not exists public.mcp_rate_limit_buckets (
  bucket_key   text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0 check (hits >= 0),
  primary key (bucket_key, window_start)
);

alter table public.mcp_rate_limit_buckets enable row level security;
revoke all on table public.mcp_rate_limit_buckets from anon, authenticated;

comment on table public.mcp_rate_limit_buckets is
  'P4-14: fixed-window hit counters for the agent surface (per token, per user, scheduler, auth failures by '
  'hashed IP). Written only by mcp_rate_limit_consume / mcp_rate_limit_note_failure. Service-role only.';

------------------------------------------------------------------------------
-- 2. public.mcp_rate_limit_consume -- all-or-nothing, denial costs nothing.
------------------------------------------------------------------------------
-- p_keys[i] is limited to p_limits[i] hits per p_window_seconds window.
-- Under a per-key advisory xact lock (taken in sorted key order, so two
-- callers sharing keys can never deadlock):
--   * if ANY key is already at its limit -> {allowed:false, limited_key,
--     retry_after_seconds}; NOTHING is incremented (a denied call does not
--     consume budget, and a per-token pass does not burn user budget when the
--     user ceiling denies, or vice versa).
--   * otherwise every key gets +1 -> {allowed:true}.
-- The lock is what makes 40 parallel calls allow exactly 30: the read and the
-- increment happen under the same lock, in one transaction.
--
-- FIXED WINDOWS, stated plainly: window_start = floor(epoch / window) * window.
-- A client can land up to 2 x limit across a window boundary. Accepted: the
-- goal is bounding runaway loops and abuse, not metering; a sliding window is
-- a later refinement if real traffic shows the need.
--
-- Upkeep: each call deletes past windows for ITS OWN keys (primary-key range,
-- cheap), so active keys never accumulate; a key that goes quiet leaves at most
-- one stale row, swept by mcp_rate_limit_prune().
create or replace function public.mcp_rate_limit_consume(
  p_keys text[],
  p_limits integer[],
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_retry integer;
  v_key text;
  v_limit integer;
  v_hits integer;
  i integer;
  v_order integer[];
begin
  if p_keys is null or p_limits is null or pg_catalog.cardinality(p_keys) = 0
     or pg_catalog.cardinality(p_keys) <> pg_catalog.cardinality(p_limits)
     or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'mcp_rate_limit_consume: keys and limits must be non-empty, equal length; window >= 1s' using errcode = '22023';
  end if;

  v_window_start := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from pg_catalog.now()) / p_window_seconds) * p_window_seconds
  );
  v_retry := greatest(1, pg_catalog.ceil(extract(epoch from (v_window_start + pg_catalog.make_interval(secs => p_window_seconds) - pg_catalog.now())))::integer);

  -- Indexes of p_keys in sorted key order (deadlock-free lock ordering).
  select pg_catalog.array_agg(o.idx order by o.k) into v_order
  from (select k, idx from pg_catalog.unnest(p_keys) with ordinality as u(k, idx)) o;

  foreach i in array v_order loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mcp_rate_limit:' || p_keys[i], 0));
  end loop;

  foreach i in array v_order loop
    v_key := p_keys[i];
    v_limit := p_limits[i];
    select b.hits into v_hits
    from public.mcp_rate_limit_buckets b
    where b.bucket_key = v_key and b.window_start = v_window_start;
    if coalesce(v_hits, 0) >= v_limit then
      return pg_catalog.jsonb_build_object('allowed', false, 'limited_key', v_key, 'retry_after_seconds', v_retry);
    end if;
  end loop;

  foreach i in array v_order loop
    insert into public.mcp_rate_limit_buckets (bucket_key, window_start, hits)
    values (p_keys[i], v_window_start, 1)
    on conflict (bucket_key, window_start) do update set hits = public.mcp_rate_limit_buckets.hits + 1;
  end loop;

  delete from public.mcp_rate_limit_buckets b
  where b.bucket_key = any (p_keys) and b.window_start < v_window_start;

  return pg_catalog.jsonb_build_object('allowed', true);
end;
$$;

revoke all on function public.mcp_rate_limit_consume(text[], integer[], integer) from public, anon, authenticated;
grant execute on function public.mcp_rate_limit_consume(text[], integer[], integer) to service_role;

comment on function public.mcp_rate_limit_consume(text[], integer[], integer) is
  'P4-14: atomically consume one hit from every key, or none if any key is at its limit (then returns '
  'retry_after_seconds). Serialized per key with advisory xact locks. service_role only. '
  'Caller: lib/mcp/rate-limit.ts consumeRateLimit.';

------------------------------------------------------------------------------
-- 3. public.mcp_rate_limit_note_failure -- count one auth failure, report
--    whether the key is now over its limit.
------------------------------------------------------------------------------
-- Unlike consume, a failure is ALWAYS counted (an attacker must not be able to
-- keep failing for free), and the answer is "are you over the limit now" so the
-- route can turn a 401/invalid_grant into 429 + Retry-After. Called only on the
-- failure path -- the authenticated happy path never touches this.
create or replace function public.mcp_rate_limit_note_failure(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_hits integer;
begin
  if p_key is null or p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'mcp_rate_limit_note_failure: key, limit >= 1 and window >= 1s are required' using errcode = '22023';
  end if;

  v_window_start := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from pg_catalog.now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.mcp_rate_limit_buckets (bucket_key, window_start, hits)
  values (p_key, v_window_start, 1)
  on conflict (bucket_key, window_start) do update set hits = public.mcp_rate_limit_buckets.hits + 1
  returning hits into v_hits;

  delete from public.mcp_rate_limit_buckets b
  where b.bucket_key = p_key and b.window_start < v_window_start;

  return pg_catalog.jsonb_build_object(
    'over_limit', v_hits > p_limit,
    'hits', v_hits,
    'retry_after_seconds',
    greatest(1, pg_catalog.ceil(extract(epoch from (v_window_start + pg_catalog.make_interval(secs => p_window_seconds) - pg_catalog.now())))::integer)
  );
end;
$$;

revoke all on function public.mcp_rate_limit_note_failure(text, integer, integer) from public, anon, authenticated;
grant execute on function public.mcp_rate_limit_note_failure(text, integer, integer) to service_role;

comment on function public.mcp_rate_limit_note_failure(text, integer, integer) is
  'P4-14: count one authentication failure against a (hashed-IP) key; returns over_limit + retry_after_seconds '
  'so the route can answer 429. service_role only. Caller: lib/mcp/auth-failure-limit.ts.';

------------------------------------------------------------------------------
-- 4. public.mcp_rate_limit_prune -- sweep stale windows of keys that went quiet.
------------------------------------------------------------------------------
-- Scheduling is an OPERATOR action (house rule, see 166's header):
--   select cron.schedule('mcp-rate-limit-prune-hourly', '41 * * * *', 'select public.mcp_rate_limit_prune()');
create or replace function public.mcp_rate_limit_prune()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.mcp_rate_limit_buckets where window_start < pg_catalog.now() - interval '1 hour';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.mcp_rate_limit_prune() from public, anon, authenticated;
grant execute on function public.mcp_rate_limit_prune() to service_role;

------------------------------------------------------------------------------
-- Verification (read-only, after apply):
--   select proname, prosecdef, proconfig,
--          has_function_privilege('authenticated', oid, 'execute') auth_exec,
--          has_function_privilege('anon', oid, 'execute') anon_exec
--     from pg_proc where proname like 'mcp_rate_limit_%';            -- prosecdef t, auth/anon f
--   select relrowsecurity from pg_class where relname = 'mcp_rate_limit_buckets';   -- t
--   select has_table_privilege('authenticated', 'public.mcp_rate_limit_buckets', 'select');  -- f
------------------------------------------------------------------------------
