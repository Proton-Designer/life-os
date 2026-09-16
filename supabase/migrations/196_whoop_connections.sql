-- 196: whoop_connections -- OAuth2 token vault for the env-gated Whoop
-- integration (P3-18, Sonnet ENG 1). Scope, per the Lead's explicit
-- ruling: connect/disconnect + token storage only. No data-sync job, no
-- consumer of Whoop's actual sleep/recovery/strain data -- see this
-- task's own OPEN_QUESTIONS.md entry for why (no existing UI surface is
-- designed to consume wearable data yet).
--
-- ENCRYPTED, REVERSIBLE, same reasoning as canvas_connections (210): a
-- future data-sync job needs the plaintext access/refresh tokens back to
-- call Whoop's API, so this reuses lib/ai/encryption.ts's AES-256-GCM
-- (API_KEY_ENCRYPTION_SECRET), not a one-way hash.
--
-- ONE CONNECTION PER USER, owner-writable RLS (mirrors canvas_connections
-- exactly): a Whoop OAuth token is a credential the user's OWN
-- authenticated session legitimately writes (the OAuth callback route is
-- itself requireUser()-authenticated), unlike migration 219's
-- fsrs_user_parameters, which is a system-computed artifact no client
-- should ever be able to write directly. `access_token_last4`/
-- `refresh_token_last4` mirror canvas_connections.token_last4's own
-- purpose: a "connected" UI hint without ever reading a decrypted secret
-- back for display.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

create table public.whoop_connections (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  encrypted_access_token   text not null,
  encrypted_refresh_token  text not null,
  access_token_last4       text not null check (length(access_token_last4) <= 8),
  token_expires_at         timestamptz not null,
  scope                    text not null,
  connected_at             timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.whoop_connections is
  'One bring-your-own-authorization Whoop OAuth2 connection per user. '
  'encrypted_access_token/encrypted_refresh_token are AES-256-GCM '
  'ciphertext under API_KEY_ENCRYPTION_SECRET (lib/ai/encryption.ts). No '
  'code path returns either plaintext, or access_token_last4''s own '
  'decrypted source, to a browser or to MCP -- see the Lead''s P3-18 '
  'ruling (ASSIGN-sonnet-eng-1.md, 20:26).';

comment on column public.whoop_connections.encrypted_refresh_token is
  'NEVER select this column into anything that reaches a Client '
  'Component or an MCP response. Needed only by a future server-side '
  'token-refresh/data-sync job, not built tonight.';

alter table public.whoop_connections enable row level security;

create policy whoop_connections_select_own on public.whoop_connections
  for select using (auth.uid() = user_id);
create policy whoop_connections_insert_own on public.whoop_connections
  for insert with check (auth.uid() = user_id);
create policy whoop_connections_update_own on public.whoop_connections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy whoop_connections_delete_own on public.whoop_connections
  for delete using (auth.uid() = user_id);

drop trigger if exists whoop_connections_touch_updated_at on public.whoop_connections;
create trigger whoop_connections_touch_updated_at
  before update on public.whoop_connections for each row execute function public.touch_updated_at();
