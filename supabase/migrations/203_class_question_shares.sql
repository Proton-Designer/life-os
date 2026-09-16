-- 203: P3-08 -- public, revocable read-only shares of a class's question
-- bank. HASHED TOKEN STORAGE, NOT THE RAW TOKEN (Opus Lead's explicit
-- requirement, same shape as mcp_access_tokens/130_mcp_access.sql): only
-- sha256(raw_token) ever reaches this table. The raw token is shown to the
-- owner exactly once, at creation, and is never recoverable afterward --
-- there is no decrypt path for a hash, which is the point (same reasoning
-- lib/mcp/tokens.ts's own header gives for PATs).
--
-- OWNERSHIP VIA THE COMPOSITE FK, not just RLS: `foreign key (user_id,
-- class_id) references classes (user_id, id)` is the SAME pattern
-- `questions` itself uses (111_ulm_reviews_card_states_unify.sql) --  a
-- share row for a class the caller doesn't own is structurally
-- unrepresentable, not merely blocked by a policy that could be
-- misconfigured later.
--
-- AT MOST ONE LIVE SHARE PER CLASS (the partial unique index below).
-- Revoking never deletes the row (revoked_at, same shape as
-- mcp_access_tokens) -- re-sharing after a revoke always INSERTS A NEW ROW
-- with a brand-new token, never resurrects the revoked one.
--
-- NO PUBLIC SELECT POLICY, DELIBERATELY. The public share-view route never
-- gets a client capable of querying this table directly -- it's a Server
-- Component doing its own service-role lookup and sending the browser only
-- the sanitized fields it chose to send. RLS here stays exactly as strict
-- as every other user-owned table: owner-only.
create table public.class_question_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid not null,
  token_hash text not null unique,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  foreign key (user_id, class_id) references public.classes (user_id, id) on delete cascade
);

create unique index class_question_shares_active_per_class
  on public.class_question_shares (class_id)
  where revoked_at is null;

create index class_question_shares_user_id_idx on public.class_question_shares (user_id);

alter table public.class_question_shares enable row level security;

create policy "class_question_shares_own_row" on public.class_question_shares
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

comment on table public.class_question_shares is
  'P3-08: public read-only share of one class''s active question bank. token_hash is sha256(raw token) -- the raw value is shown to the owner once, at creation, and is never stored. No public RLS policy: the public /share/[token] route reads via the service-role client in application code, never PostgREST directly.';
