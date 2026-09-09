-- L2 of the AI-integration program (docs/ai-connector/PROGRAM-PLAN.md): the
-- MCP access tokens (PATs) Settings can issue/list/revoke, and the append-
-- only log of what was done with them. No MCP server reads either table yet
-- -- that's L3+. This layer only has to prove tokens exist and are
-- manageable, in the UI, before any protocol code exists.
--
-- mcp_access_tokens mirrors migration 104's user_api_keys idiom deliberately
-- -- both are bring-your-own-credential storage, never the plaintext, only
-- enough (a hash, a last4) to recognise the row without reviving the secret.
-- The one real difference: 104's DeepSeek key is the USER's credential spent
-- against a third party, so it's ENCRYPTED (AES-256-GCM, reversible -- the
-- app has to hand the plaintext back to DeepSeek on every call). A PAT is
-- OUR credential, spent against Life OS itself by whoever holds it, and
-- nothing ever needs the plaintext back -- only a yes/no "does this match
-- what was issued". So it's HASHED (sha256, one-way) rather than encrypted.
-- There is no decrypt path for a PAT and there must never be one.
--
-- scopes is this layer's own addition -- the handoff doc names "scoped
-- tokens" as a load-bearing guardrail against the accepted prompt-injection
-- risk (see PROGRAM-PLAN.md's "one risk stated once") but never defines the
-- scopes. 'read' and 'write' are the two verbs. A read-only token has to be
-- genuinely mintable, not just theoretically expressible, because it is the
-- actual mitigation someone reaches for when they want to connect a model
-- that only looks. Non-empty is enforced too: a token that grants nothing
-- is a footgun (it looks configured, does nothing, and nobody notices until
-- the model they connected it to can't do what they expected).
--
-- token_hash is looked up by an exact index hit (L3's route will query
-- `where token_hash = sha256(presented_token)`), not by scanning rows and
-- comparing in application code -- the lookup key is already a one-way hash
-- of 256 random bits, not a secret being compared byte by byte, so there is
-- nothing for a timing side-channel to learn from the index scan itself.
-- The actual timing-safe comparison this layer promised lives in
-- lib/mcp/tokens.ts, one level up from here, guarding the values that DO
-- need it.

create table if not exists public.mcp_access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null,
  token_last4 text not null check (length(token_last4) <= 8),
  label text,
  -- cardinality(), NOT array_length(scopes, 1): array_length() on an empty
  -- array returns NULL (not 0), and Postgres CHECK constraints PASS on a
  -- NULL expression -- they only fail on an explicit FALSE. So
  -- `array_length(scopes,1) > 0` evaluates to `NULL > 0` = NULL for `'{}'`,
  -- the whole `and` short-circuits to NULL, and the row is silently
  -- accepted with zero permissions -- an app-layer test (validateScopes([])
  -- in lib/mcp/tokens.ts) passing is what let this ship looking covered;
  -- nothing exercised the DB's OWN defense-in-depth copy of that rule.
  --
  -- Proven red, then green, against a scratch Postgres 16.13 (not this
  -- table's literal DDL in isolation -- the actual CREATE TABLE below,
  -- applied verbatim):
  --
  --   -- with `array_length(scopes,1) > 0` (the original, broken, version):
  --   insert into mcp_access_tokens (..., scopes) values (..., '{}');
  --   => INSERT 0 1                                     -- WRONG: accepted
  --
  --   select array_length('{}'::text[],1), cardinality('{}'::text[]);
  --   =>           <NULL>          |          0
  --
  --   -- with `cardinality(scopes) > 0` (this version):
  --   insert into mcp_access_tokens (..., scopes) values (..., '{}');
  --   => ERROR: new row for relation "mcp_access_tokens" violates check
  --      constraint "mcp_access_tokens_scopes_check"
  --      DETAIL: Failing row contains (..., {}).               -- correct
  --   insert into mcp_access_tokens (..., scopes) values (..., array['read']);
  --   => INSERT 0 1                                    -- real scopes still work
  scopes text[] not null
    check (scopes <@ array['read', 'write']::text[] and cardinality(scopes) > 0),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

comment on table public.mcp_access_tokens is
  'Personal-access tokens for the MCP connector (L2, docs/ai-connector/PROGRAM-PLAN.md). '
  'The raw token is shown exactly once, at creation, and is never stored anywhere -- '
  'token_hash is a one-way sha256 of it. There is no read path that returns the raw '
  'token or a reversible form of it to a browser; the UI shows token_last4 only. '
  'revoked_at marks a token dead without deleting the row, so a revoked token stays '
  'visible in its own history instead of silently vanishing.';

comment on column public.mcp_access_tokens.token_hash is
  'sha256(raw token), hex. One-way -- there is deliberately no decrypt/reverse path, '
  'unlike user_api_keys.encrypted_key (migration 104), because nothing downstream of '
  'issuance ever needs the plaintext back, only a match/no-match verdict. '
  'NEVER select this column into anything that reaches a Client Component.';

comment on column public.mcp_access_tokens.scopes is
  'Subset of (''read'', ''write''), non-empty. The actual mitigation for a write-capable '
  'tool that may read attacker-controlled content (PROGRAM-PLAN.md''s accepted-risk note) '
  '-- a connection meant to only look can be issued a token that cannot write, for real.';

alter table public.mcp_access_tokens enable row level security;

-- Own rows only, all four verbs -- same shape as user_api_keys (migration 104).
-- Reading your own row is harmless: token_hash is useless without reversing
-- sha256, so even that read yields nothing spendable.
create policy mcp_access_tokens_select_own on public.mcp_access_tokens
  for select using (auth.uid() = user_id);
create policy mcp_access_tokens_insert_own on public.mcp_access_tokens
  for insert with check (auth.uid() = user_id);
create policy mcp_access_tokens_update_own on public.mcp_access_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy mcp_access_tokens_delete_own on public.mcp_access_tokens
  for delete using (auth.uid() = user_id);

create unique index if not exists mcp_access_tokens_token_hash_key on public.mcp_access_tokens (token_hash);
create index if not exists mcp_access_tokens_user_id_idx on public.mcp_access_tokens (user_id);

-- Append-only audit trail of every tool call made under a token. This is the
-- load-bearing guardrail PROGRAM-PLAN.md requires ship in the same layer as
-- the first write tool (L6) -- the table exists now, in L2, so nothing in L6
-- is waiting on a migration that could have landed earlier.
--
-- Deliberately NOT mirroring mcp_access_tokens' four-policy shape: a select
-- policy only. An audit log the subject can edit or delete is not an audit
-- log -- it's a note to self. Writes to this table arrive from the MCP
-- route's service-role-backed path (L3+), which bypasses RLS entirely by
-- design, never from the user's own RLS-scoped client.
create table if not exists public.mcp_audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_id uuid references public.mcp_access_tokens (id) on delete set null,
  tool_name text not null,
  args jsonb not null,
  outcome text not null check (outcome in ('ok', 'error', 'denied')),
  result_summary text,
  created_at timestamptz not null default now()
);

comment on table public.mcp_audit_log is
  'Append-only record of every MCP tool call. No insert/update/delete policy for the '
  'user on purpose -- see the header above this table. token_id is nullable and '
  'ON DELETE SET NULL (single-column FK, not composite, so no scoped-column hazard '
  'like migration 129''s) so revoking or losing the token that made a call never '
  'deletes the historical record of the call itself.';

alter table public.mcp_audit_log enable row level security;

create policy mcp_audit_log_select_own on public.mcp_audit_log
  for select using (auth.uid() = user_id);

create index if not exists mcp_audit_log_user_id_created_at_idx
  on public.mcp_audit_log (user_id, created_at desc);

-- L3's per-token rate limiter (PROGRAM-PLAN.md) counts recent rows BY TOKEN,
-- not by user -- a user with several tokens must not have one noisy token
-- exhaust the budget of another. Added now, while the table is still
-- unapplied, rather than as a second migration touching the same table twice.
create index if not exists mcp_audit_log_token_id_created_at_idx
  on public.mcp_audit_log (token_id, created_at desc);
