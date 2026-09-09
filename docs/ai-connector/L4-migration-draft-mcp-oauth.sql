-- DRAFT — NOT a numbered migration. Per supabase/migrations/ALLOCATIONS.md's
-- own rule ("Numbers are allocated by the LifeOS lead only. Nobody
-- self-assigns"), this file deliberately lives OUTSIDE supabase/migrations/
-- so it can never be mistaken for an applied or pending migration. File it
-- as supabase/migrations/<N>_mcp_oauth.sql once a number is allocated, then
-- delete this draft.
--
-- L4 of the AI-integration program (docs/ai-connector/PROGRAM-PLAN.md): the
-- three new tables the hand-rolled OAuth 2.1 authorization server
-- (app/api/mcp/oauth/*) needs. Does NOT touch migration 130 (frozen, per the
-- Lead's own instruction) or mcp_access_tokens' shape — the OAuth flow mints
-- ordinary mcp_access_tokens rows via the SAME lib/mcp/tokens.ts helper
-- Settings' "Create token" button uses (createAccessToken), per the explicit
-- instruction not to invent a parallel credential.

-- mcp_oauth_clients: RFC 7591 Dynamic Client Registration. Public
-- (PKCE-only, no client_secret) by design -- this program supports exactly
-- one confidential pattern: none. Registration is unauthenticated by nature
-- (it happens before any user session exists), so this carries RLS enabled
-- with ZERO policies -- deny-all to every role except service_role, the
-- same shape DATA-INVENTORY.md found already correct for this program's two
-- genuinely operational tables (migration_ledger,
-- migration_115_orphaned_group_weight_log). Every access is service-role,
-- from exactly two routes (register writes; authorize/token read) -- there
-- is no point in this program where a user's own RLS-scoped client should
-- ever see a client registration row.
create table if not exists public.mcp_oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  client_name text,
  redirect_uris text[] not null check (cardinality(redirect_uris) > 0 and cardinality(redirect_uris) <= 10),
  created_at timestamptz not null default now()
);

comment on table public.mcp_oauth_clients is
  'RFC 7591 Dynamic Client Registration records (L4). Public/unauthenticated at '
  'registration time by design -- see app/api/mcp/oauth/authorize/route.ts''s mandatory '
  'consent step for why registering a client here grants no access by itself. RLS enabled, '
  'zero policies: service-role only, same shape as this program''s two deny-all operational '
  'tables (DATA-INVENTORY.md).';

create unique index if not exists mcp_oauth_clients_client_id_key on public.mcp_oauth_clients (client_id);
alter table public.mcp_oauth_clients enable row level security;

-- mcp_oauth_codes: single-use authorization codes (RFC 6749 sec 4.1).
-- Minted with a REAL user session at /authorize (own-row RLS, same shape as
-- mcp_access_tokens -- select/insert only, no update/delete policy for the
-- user), consumed at /token where no session exists yet (service-role,
-- same asymmetry as mcp_access_tokens.verifyAccessToken already documents).
-- Single-use is enforced by lib/mcp/oauth.ts's consumeAuthorizationCode
-- doing `UPDATE ... WHERE used_at IS NULL`, not a separate check-then-write
-- -- see that function's own comment for why the atomicity matters.
create table if not exists public.mcp_oauth_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null,
  client_id text not null references public.mcp_oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null check (code_challenge_method = 'S256'),
  resource text,
  scopes text[] not null check (scopes <@ array['read','write']::text[] and cardinality(scopes) > 0),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.mcp_oauth_codes is
  'RFC 6749 sec 4.1 single-use authorization codes (L4). code_hash is a one-way sha256, '
  'same posture as mcp_access_tokens.token_hash -- there is no decrypt path and must never '
  'be one. code_challenge_method is CHECKed to S256 only; this server never accepts the '
  '"plain" PKCE downgrade.';

comment on column public.mcp_oauth_codes.used_at is
  'NULL until redeemed. Consumption is an atomic `UPDATE ... WHERE used_at IS NULL`, not a '
  'read-then-write -- see lib/mcp/oauth.ts''s consumeAuthorizationCode. Two concurrent '
  'redemption attempts for the same code can both match `used_at IS NULL` only if there is a '
  'race; at most one UPDATE wins, and the loser is correctly treated as "already used".';

create unique index if not exists mcp_oauth_codes_code_hash_key on public.mcp_oauth_codes (code_hash);
alter table public.mcp_oauth_codes enable row level security;

create policy mcp_oauth_codes_select_own on public.mcp_oauth_codes
  for select using (auth.uid() = user_id);
create policy mcp_oauth_codes_insert_own on public.mcp_oauth_codes
  for insert with check (auth.uid() = user_id);
-- No update/delete policy for the user: consuming a code (setting used_at)
-- happens at /token, which has no session and uses service-role by
-- necessity, never the user's own client.

-- mcp_oauth_refresh_tokens: OAuth refresh tokens (RFC 6749 sec 6), minted
-- and rotated entirely at /token (no session -- service-role both times,
-- same asymmetry as above). rotated_at marks a token as spent; a SECOND
-- redemption attempt against an already-rotated token is refresh-token
-- reuse -- the standard signal a token was stolen -- and
-- lib/mcp/oauth.ts's rotateRefreshToken tells its caller
-- (app/api/mcp/oauth/token/route.ts) to revoke the whole linked
-- mcp_access_tokens row on that signal, not just reject the one request.
create table if not exists public.mcp_oauth_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  access_token_id uuid not null references public.mcp_access_tokens (id) on delete cascade,
  client_id text not null references public.mcp_oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

comment on table public.mcp_oauth_refresh_tokens is
  'OAuth refresh tokens (L4). The access token this guards has no clock-based expiry '
  '(mcp_access_tokens carries none, deliberately -- see app/api/mcp/oauth/token/route.ts''s '
  'header) -- rotation-with-reuse-detection is a theft SIGNAL independent of any expiry, not '
  'a substitute for one. Reuse of an already-rotated token revokes the linked access token '
  '(mcp_access_tokens.revoked_at), implemented in the route, not here.';

create unique index if not exists mcp_oauth_refresh_tokens_token_hash_key on public.mcp_oauth_refresh_tokens (token_hash);
alter table public.mcp_oauth_refresh_tokens enable row level security;

-- Select-only own-row policy for future-proofing (a Settings "active OAuth
-- sessions" view could read this directly one day) -- insert/rotate both
-- happen via service-role at /token, where no session exists yet.
create policy mcp_oauth_refresh_tokens_select_own on public.mcp_oauth_refresh_tokens
  for select using (auth.uid() = user_id);

create index if not exists mcp_oauth_refresh_tokens_access_token_id_idx
  on public.mcp_oauth_refresh_tokens (access_token_id);
