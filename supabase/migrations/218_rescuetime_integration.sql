-- 218: RescueTime integration (P3-19, Team B, tracking-app-4b). BYOK
-- (user's own RescueTime API key) -- same encrypted-token-vault shape as
-- migration 210's canvas_connections, one connection per user. A second
-- table caches the fetched daily productivity summary so the Insights
-- panel reads from Postgres, never triggers a live RescueTime call on every
-- page load.
--
-- ENCRYPTED, REVERSIBLE -- same reasoning as canvas_connections (210)/
-- user_api_keys (104): every sync call needs the plaintext key back, so a
-- one-way hash (mcp_access_tokens' own pattern, 130) would make the
-- credential unusable after storage.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

create table public.rescuetime_connections (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  encrypted_key    text not null,
  key_last4        text not null check (length(key_last4) <= 8),
  last_synced_at   timestamptz null,
  last_sync_error  text null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.rescuetime_connections is
  'One bring-your-own RescueTime connection per user (API key only -- '
  'RescueTime''s own host is fixed, unlike Canvas''s user-supplied instance '
  'URL). encrypted_key is AES-256-GCM ciphertext under '
  'API_KEY_ENCRYPTION_SECRET (lib/ai/encryption.ts), same pattern as '
  'canvas_connections (210). No code path returns encrypted_key or its '
  'plaintext to a browser -- the UI reads key_last4 only.';

comment on column public.rescuetime_connections.encrypted_key is
  'AES-256-GCM, stored as iv:authTag:ciphertext in base64 '
  '(lib/ai/encryption.ts). NEVER select this column into anything that '
  'reaches a Client Component.';

alter table public.rescuetime_connections enable row level security;

create policy rescuetime_connections_select_own on public.rescuetime_connections
  for select using (auth.uid() = user_id);
create policy rescuetime_connections_insert_own on public.rescuetime_connections
  for insert with check (auth.uid() = user_id);
create policy rescuetime_connections_update_own on public.rescuetime_connections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy rescuetime_connections_delete_own on public.rescuetime_connections
  for delete using (auth.uid() = user_id);

drop trigger if exists rescuetime_connections_touch_updated_at on public.rescuetime_connections;
create trigger rescuetime_connections_touch_updated_at
  before update on public.rescuetime_connections for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------

-- Cached daily productivity summary from RescueTime's Daily Summary Feed API
-- -- percentages stored as RescueTime reports them (0-100), never
-- re-derived. unique(user_id, summary_date): a resync overwrites that day's
-- row rather than accumulating duplicates.
create table public.rescuetime_daily_summaries (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users (id) on delete cascade,
  summary_date                date not null,
  productivity_pulse          int null,
  very_productive_percentage  numeric null,
  productive_percentage       numeric null,
  neutral_percentage          numeric null,
  distracting_percentage      numeric null,
  very_distracting_percentage numeric null,
  total_hours                 numeric null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  unique (user_id, summary_date)
);

comment on table public.rescuetime_daily_summaries is
  'Cached rows from RescueTime''s Daily Summary Feed API (lib/rescuetime/client.ts) '
  '-- read by the Insights panel, never fetched live on page load. '
  'unique(user_id, summary_date): a resync UPSERTs that day, never '
  'duplicates it.';

create index rescuetime_daily_summaries_user_date_idx
  on public.rescuetime_daily_summaries (user_id, summary_date desc);

alter table public.rescuetime_daily_summaries enable row level security;

create policy rescuetime_daily_summaries_select_own on public.rescuetime_daily_summaries
  for select using (auth.uid() = user_id);
create policy rescuetime_daily_summaries_insert_own on public.rescuetime_daily_summaries
  for insert with check (auth.uid() = user_id);
create policy rescuetime_daily_summaries_update_own on public.rescuetime_daily_summaries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy rescuetime_daily_summaries_delete_own on public.rescuetime_daily_summaries
  for delete using (auth.uid() = user_id);

drop trigger if exists rescuetime_daily_summaries_touch_updated_at on public.rescuetime_daily_summaries;
create trigger rescuetime_daily_summaries_touch_updated_at
  before update on public.rescuetime_daily_summaries for each row execute function public.touch_updated_at();
