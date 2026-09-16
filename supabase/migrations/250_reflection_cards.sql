-- 250: P3-05 -- cards library (Goal/Motivation/Thought-Habit/Trait) +
-- End-of-Hour ritual, behind a new shared opt-in feature flag
-- (Sonnet ENG 2, self-allocated against ALLOCATIONS.md's own "next free"
-- marker after 209 -- the number this task originally requested -- was
-- consumed by P4-22's mcp_webhooks between request and grant; confirmed
-- no other file/ledger row claims 250 before writing this).
--
-- OPT-IN, MIRROR OF hidden_features: `profiles.hidden_features` (an
-- earlier migration) hides an existing, default-ON module; this is the
-- opposite direction -- `enabled_features` turns ON a new, default-OFF
-- feature. Same text[]-on-profiles shape and CHECK-against-a-closed-set
-- convention, reused rather than reinvented (lib/opt-in-features.ts,
-- already committed). Shared by BOTH P3-05 (cards_library) and P3-11
-- (estimate_vs_actual, not yet built) -- one flag column, not two
-- near-duplicate booleans, since both features are the same engineer's
-- and need the identical shape.
--
-- ARCHIVE, NEVER HARD-DELETE: reflection_cards.active mirrors every other
-- user-authored library table this session (question banks, staging
-- batches, etc.) -- a card the user "removes" stays queryable for
-- historical end_of_hour_reflections rows to keep referencing.
--
-- COMPOSITE TENANCY FK on end_of_hour_reflections.card_id, per this
-- program's own standing rule (100/101/146/210's own header): a
-- single-column FK would let a row claim user A's reflection against user
-- B's card, since FK validation checks existence only, never ownership,
-- and RLS does not apply to FK checks. reflection_cards_user_id_id_key
-- (added below) is what the composite FK references.
--
-- APPEND-ONLY: end_of_hour_reflections has select+insert RLS only, no
-- update/delete -- a logged reflection is a historical record, not an
-- editable one, same posture as every other append-only log table
-- tonight (mcp_audit_log, habit_votes, etc.).
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

alter table public.profiles
  add column enabled_features text[] not null default '{}'
  check (enabled_features <@ array['cards_library', 'estimate_vs_actual']);

comment on column public.profiles.enabled_features is
  'P3-05/P3-11: opt-in feature flags, mirror-image of hidden_features (which hides an existing default-ON module -- this turns ON a new default-OFF one). Additive: default reproduces todays behavior exactly, both features start absent for every existing user.';

create table public.reflection_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('goal', 'motivation', 'thought_habit', 'trait')),
  content text not null check (length(trim(content)) > 0),
  active boolean not null default true,
  last_shown_at timestamptz null,
  created_at timestamptz not null default now()
);

-- Referenced by end_of_hour_reflections' composite tenancy FK below.
alter table public.reflection_cards
  add constraint reflection_cards_user_id_id_key unique (user_id, id);

create index reflection_cards_user_id_active_idx on public.reflection_cards (user_id) where active;

alter table public.reflection_cards enable row level security;

create policy "reflection_cards_select_own" on public.reflection_cards
  for select using (user_id = (select auth.uid()));
create policy "reflection_cards_insert_own" on public.reflection_cards
  for insert with check (user_id = (select auth.uid()));
-- UPDATE, not DELETE: archiving (active -> false) and the End-of-Hour
-- rotation's own last_shown_at stamp are both updates; a card is never
-- hard-deleted by the owning user (or anyone else -- no delete policy).
create policy "reflection_cards_update_own" on public.reflection_cards
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

comment on table public.reflection_cards is
  'P3-05: a users own Goal/Motivation/Thought-Habit/Trait cards for the End-of-Hour ritual. Archive-never-delete (active=false), same convention as every other user-authored library table this session. Gated end to end by profiles.enabled_features containing ''cards_library'' -- server-side in every Server Action/MCP entity, never trusting the client to have honestly hidden the UI.';

create table public.end_of_hour_reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id uuid not null,
  logged_at timestamptz not null default now(),
  response text null,
  constraint end_of_hour_reflections_card_fk
    foreign key (user_id, card_id) references public.reflection_cards (user_id, id) on delete cascade
);

create index end_of_hour_reflections_user_id_logged_at_idx on public.end_of_hour_reflections (user_id, logged_at desc);

alter table public.end_of_hour_reflections enable row level security;

create policy "end_of_hour_reflections_select_own" on public.end_of_hour_reflections
  for select using (user_id = (select auth.uid()));
create policy "end_of_hour_reflections_insert_own" on public.end_of_hour_reflections
  for insert with check (user_id = (select auth.uid()));

comment on table public.end_of_hour_reflections is
  'P3-05: append-only log of End-of-Hour ritual submissions. No update/delete RLS policy for the owning user -- a logged reflection is a historical record. Composite tenancy FK (user_id, card_id) -> reflection_cards(user_id, id) makes a cross-account row unrepresentable.';
