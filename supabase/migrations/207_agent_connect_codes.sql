-- 207: P4-21 -- single-use, one-click "connect your agent" codes. A user
-- generates a short-lived link in Settings and pastes it to an AI agent
-- (ChatGPT, Claude, Gemini, Perplexity, a text-based assistant) instead of
-- pasting a long-lived token directly into a chat transcript.
--
-- HASHED CODE STORAGE, NOT THE RAW CODE (Opus Lead's explicit ruling: "the
-- connect code is a BEARER CREDENTIAL that mints a token, so it gets the
-- same discipline as the share link in P3-08" -- same shape as
-- class_question_shares/203 and mcp_access_tokens/130): only
-- sha256(raw code) ever reaches this table. The raw code is embedded in
-- the one-time URL shown to the owner at creation and is never stored or
-- logged in plaintext anywhere.
--
-- token_expiry_choice/scopes are the user's OWN choice at generation time
-- (Opus Lead: "scoped by what the user chose in Settings, never a blanket
-- read+write default") -- carried here so the EXCHANGE step (GET or POST
-- on /connect/[code], app/connect/[code]/route.ts) knows what to mint
-- without the agent supplying anything itself.
--
-- SINGLE-USE, BURN ON FIRST HIT: `used_at` is set by whichever of GET/POST
-- fires first (a real exchange, not a repeatable "instructions" response);
-- a second hit (of either verb) is rejected identically to an unknown or
-- expired code -- no enumeration signal, same posture P3-08's public
-- share route already established.
--
-- `expires_at` here is the CODE's own short (10-minute) window -- entirely
-- separate from `token_expiry_choice`, which governs how long the MINTED
-- TOKEN lives once the exchange succeeds.
--
-- NO PUBLIC SELECT POLICY, DELIBERATELY. The exchange route
-- (app/connect/[code]/route.ts) is hit by an unauthenticated agent, never
-- the owning user's own session -- it always reads/writes this table via
-- a service-role client in application code, never PostgREST directly.
-- RLS here stays owner-only, for Settings' own "you have a pending
-- connect link" list.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

create table public.agent_connect_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code_hash text not null unique,
  scopes text[] not null,
  token_expiry_choice text not null,
  label text null,
  expires_at timestamptz not null,
  used_at timestamptz null,
  minted_token_id uuid null references public.mcp_access_tokens(id) on delete set null,
  created_at timestamptz not null default now()
);

create index agent_connect_codes_user_id_idx on public.agent_connect_codes (user_id);

alter table public.agent_connect_codes enable row level security;

create policy "agent_connect_codes_select_own" on public.agent_connect_codes
  for select using (user_id = (select auth.uid()));

create policy "agent_connect_codes_insert_own" on public.agent_connect_codes
  for insert with check (user_id = (select auth.uid()));

comment on table public.agent_connect_codes is
  'P4-21: single-use, short-lived (10 min) codes that exchange for a real mcp_access_tokens row (client_kind=''agent''). code_hash is sha256(raw code) -- the raw value only ever appears in the one-time /connect/[code] URL, never stored. No update/delete policy for the owning user: the exchange route (service-role) is the only writer of used_at/minted_token_id, and a code is never edited, only consumed once.';

comment on column public.agent_connect_codes.expires_at is
  'The CODE''s own short window (10 minutes from creation) -- separate from token_expiry_choice, which governs the minted token''s own lifetime once exchanged.';

comment on column public.agent_connect_codes.used_at is
  'Set by whichever of GET/POST on /connect/[code] successfully exchanges this code first. A second hit of either verb is rejected identically to an unknown or expired code.';
