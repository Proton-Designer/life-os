-- 210: Canvas API client foundation -- encrypted token vault (BYO instance
-- URL + personal access token) plus Canvas course <-> local class mapping.
-- (P2-20, Team B / Phase 2 CollegeOS Canvas integration. Build order per
-- phase-2-build-plan.md: token vault -> course mapping -> grade sync /
-- announcement polling -> expiry handling -> sync status screen. This
-- migration is layer 1 -- P2-21 (announcements/grades) and P3-13 (ICS
-- reconciliation) build on canvas_course_mappings.class_id.)
--
-- ENCRYPTED, REVERSIBLE -- same reasoning as migration 104's user_api_keys,
-- not migration 130's mcp_access_tokens. A Canvas PAT is the USER's
-- credential, spent against a third party (Canvas) by this app on every
-- sync, so the plaintext must be recoverable -- reuses lib/ai/encryption.ts's
-- AES-256-GCM (API_KEY_ENCRYPTION_SECRET), not a new crypto implementation.
-- Contrast mcp_access_tokens: OUR credential, hashed one-way, because
-- nothing downstream ever needs it back, only a match/no-match verdict.
--
-- ONE CONNECTION PER USER: primary key (user_id), not (user_id, id) like
-- user_api_keys' (user_id, provider) -- there is exactly one Canvas
-- instance a person's account talks to, not many providers. A reconnect
-- upserts over the prior row, same replace-not-accumulate reasoning as
-- 104's own header (a rotated token must not leave the old one behind).
--
-- COMPOSITE TENANCY FK on canvas_course_mappings.class_id, per 100/101/146:
-- a single-column `class_id references classes(id)` would let a row claim
-- user A's mapping against user B's class -- FK checks existence only,
-- never ownership, and RLS does not apply to FK validation. classes'
-- (user_id, id) unique index (classes_user_id_id_key, migration 058)
-- already exists; no new index needed.
--
-- SCOPED SET NULL on class_id, per 129/140/146: deleting the local class
-- must not delete the record that this Canvas course was ever seen --
-- only un-map it, since the course still exists in Canvas and may be
-- remapped later. An unscoped SET NULL would null every column of the
-- composite key, including user_id (not-null here) -- "(class_id)" scopes
-- it to just that column.
--
-- No begin;/commit; -- the runner (apply-migration.sh) owns the transaction.

create table public.canvas_connections (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  instance_url     text not null check (instance_url ~ '^https://'),
  encrypted_token  text not null,
  token_last4      text not null check (length(token_last4) <= 8),
  canvas_user_id   text null,
  canvas_user_name text null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.canvas_connections is
  'One bring-your-own Canvas connection per user (instance URL + personal '
  'access token). encrypted_token is AES-256-GCM ciphertext under '
  'API_KEY_ENCRYPTION_SECRET (lib/ai/encryption.ts), same pattern as '
  'migration 104''s user_api_keys -- reversible (unlike mcp_access_tokens'' '
  'one-way hash, migration 130) because every sync call needs the plaintext '
  'back. No code path returns encrypted_token or its plaintext to a '
  'browser -- the UI reads token_last4 only.';

comment on column public.canvas_connections.encrypted_token is
  'AES-256-GCM, stored as iv:authTag:ciphertext in base64 '
  '(lib/ai/encryption.ts). NEVER select this column into anything that '
  'reaches a Client Component.';

alter table public.canvas_connections enable row level security;

create policy canvas_connections_select_own on public.canvas_connections
  for select using (auth.uid() = user_id);
create policy canvas_connections_insert_own on public.canvas_connections
  for insert with check (auth.uid() = user_id);
create policy canvas_connections_update_own on public.canvas_connections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy canvas_connections_delete_own on public.canvas_connections
  for delete using (auth.uid() = user_id);

drop trigger if exists canvas_connections_touch_updated_at on public.canvas_connections;
create trigger canvas_connections_touch_updated_at
  before update on public.canvas_connections for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------

create table public.canvas_course_mappings (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  canvas_course_id   text not null,
  canvas_course_name text not null,
  canvas_course_code text null,
  class_id           uuid null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint canvas_course_mappings_class_same_user
    foreign key (user_id, class_id) references public.classes (user_id, id)
    on delete set null (class_id),

  unique (user_id, canvas_course_id)
);

comment on table public.canvas_course_mappings is
  'Canvas course <-> local classes row mapping -- one row per Canvas course '
  'the user has synced, whether or not it is mapped to a local class yet '
  '(class_id null means "seen, not mapped"). canvas_course_name/code are '
  'cached at last sync so the mapping UI renders without a live Canvas '
  'call on every page load.';

comment on column public.canvas_course_mappings.class_id is
  'Nullable: SET NULL (not CASCADE) on class delete, scoped to this column '
  'only (129/140/146 pattern) -- deleting a local class must not delete the '
  'record that this Canvas course was already seen, only un-map it.';

alter table public.canvas_course_mappings enable row level security;

create policy canvas_course_mappings_select_own on public.canvas_course_mappings
  for select using (auth.uid() = user_id);
create policy canvas_course_mappings_insert_own on public.canvas_course_mappings
  for insert with check (auth.uid() = user_id);
create policy canvas_course_mappings_update_own on public.canvas_course_mappings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy canvas_course_mappings_delete_own on public.canvas_course_mappings
  for delete using (auth.uid() = user_id);

create index canvas_course_mappings_user_id_idx on public.canvas_course_mappings (user_id);
create index canvas_course_mappings_class_id_idx on public.canvas_course_mappings (class_id) where class_id is not null;

drop trigger if exists canvas_course_mappings_touch_updated_at on public.canvas_course_mappings;
create trigger canvas_course_mappings_touch_updated_at
  before update on public.canvas_course_mappings for each row execute function public.touch_updated_at();
