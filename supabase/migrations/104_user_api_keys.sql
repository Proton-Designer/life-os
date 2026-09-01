-- Bring-your-own API key storage.
--
-- WHY (2026-09-01, Ayman's ruling)
--
-- The app must run fully without anyone paying for anything. AI-backed features
-- are OPT-IN: a user who wants them supplies their own provider key, and a user
-- who doesn't gets an app that works, with those features simply absent rather
-- than broken or nagging. No feature may become unusable because a key is
-- missing, and nothing may bill Ayman for a user's usage.
--
-- ENCRYPTED AT REST, and this is not theatre. RLS already stops user A reading
-- user B's key, but RLS is a query-time control: it does nothing for a database
-- dump, a backup, a compromised service-role credential, or a support engineer
-- with a psql session. A provider key is a bearer credential that spends the
-- user's money — the blast radius of a leak is a bill, not just a privacy
-- breach. So the ciphertext is AES-256-GCM (lib/ai/encryption.ts) under a
-- server-held secret that lives outside this database. Someone holding the
-- database alone holds nothing usable.
--
-- WHAT IS DELIBERATELY NOT STORED: the plaintext key, ever, anywhere. The
-- column below only ever receives ciphertext, and `key_last4` exists so the UI
-- can say "sk-…8f2c" without a round trip through decryption. There is no
-- read path that returns a key to a browser — see api-key-actions.ts.
--
-- PRIMARY KEY (user_id, provider): one key per provider per user, and an upsert
-- replaces rather than accumulates. A user re-pasting a rotated key must not
-- leave the old one behind — a stale credential nobody knows is stored is
-- exactly the kind of thing that outlives the account it belonged to.

create table if not exists public.user_api_keys (
  user_id       uuid not null references auth.users (id) on delete cascade,
  provider      text not null check (provider in ('deepseek')),
  encrypted_key text not null,
  key_last4     text not null check (length(key_last4) <= 8),
  label         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, provider)
);

comment on table public.user_api_keys is
  'User-supplied provider credentials for OPT-IN AI features. encrypted_key is '
  'AES-256-GCM ciphertext under a server-held secret (API_KEY_ENCRYPTION_SECRET) '
  'that is NOT in this database — a dump of this table alone yields nothing '
  'usable. No code path returns a decrypted key to a browser; the UI reads '
  'key_last4 only. The app must remain fully functional with zero rows here.';

comment on column public.user_api_keys.encrypted_key is
  'AES-256-GCM, stored as iv:authTag:ciphertext in base64. NEVER select this '
  'column into anything that reaches a Client Component.';

alter table public.user_api_keys enable row level security;

-- Own rows only, all four verbs. A user may read their own row because it is
-- theirs — they typed it — but the encrypted_key is useless without the
-- server-held secret, so even that read yields nothing spendable.
create policy user_api_keys_select_own on public.user_api_keys
  for select using (auth.uid() = user_id);
create policy user_api_keys_insert_own on public.user_api_keys
  for insert with check (auth.uid() = user_id);
create policy user_api_keys_update_own on public.user_api_keys
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy user_api_keys_delete_own on public.user_api_keys
  for delete using (auth.uid() = user_id);

create index if not exists user_api_keys_user_id_idx on public.user_api_keys (user_id);
