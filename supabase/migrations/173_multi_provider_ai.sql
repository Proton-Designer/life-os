-- Phase 1: multi-provider AI (Ayman's request via the Phase-1 Opus lead,
-- 2026-09-14). Allocated `173`.
--
-- WIDENS user_api_keys.provider (104) from the deepseek-only CHECK to the
-- 6-provider set lib/ai/providers.ts now registers. The constraint's name
-- is Postgres's own generated default for a column-level inline CHECK
-- (`<table>_<column>_check`) -- same naming convention migration 120's own
-- allocation note already documented, not guessed fresh here.
--
-- NEW TABLE user_ai_preferences: which provider + tier (budget/flagship) a
-- user has chosen, kept SEPARATE from user_api_keys (104) on purpose -- a
-- user may hold keys for several providers but has exactly one active
-- choice at a time, and "which key do I have" and "which one do I want
-- used" are genuinely different questions with different write patterns
-- (keys change rarely and one-at-a-time; a preference is a single settings
-- toggle). One row per user, upserted, matching user_api_keys' own
-- "PRIMARY KEY ... an upsert replaces rather than accumulates" precedent.
--
-- model_tier, NOT a model id: storing 'cheap'/'capable' rather than the raw
-- model string means a provider's flagship/budget MODEL ID can change
-- (catalog drift, a retired id) without a data migration touching every
-- user's row -- the tier is a stable choice, the actual id it resolves to
-- lives in lib/ai/providers.ts/model-catalog.ts, read fresh on every call.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

alter table public.user_api_keys drop constraint user_api_keys_provider_check;
alter table public.user_api_keys add constraint user_api_keys_provider_check
  check (provider in ('deepseek', 'anthropic', 'openai', 'google', 'moonshot', 'xai'));

create table public.user_ai_preferences (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  provider    text not null default 'deepseek'
                check (provider in ('deepseek', 'anthropic', 'openai', 'google', 'moonshot', 'xai')),
  model_tier  text not null default 'cheap' check (model_tier in ('cheap', 'capable')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.user_ai_preferences is
  'Which AI provider + tier (budget/flagship) a user has chosen -- separate '
  'from user_api_keys (104), which holds credentials. Absence of a row means '
  'the deepseek/cheap default, same as every other opt-in AI setting in this '
  'app: absence is a guarded default, never a broken state.';

comment on column public.user_ai_preferences.model_tier is
  'cheap|capable, NOT a raw model id -- lib/ai/providers.ts/model-catalog.ts '
  'resolve the tier to a real model id fresh on every call, so a catalog id '
  'change never needs a data migration here.';

alter table public.user_ai_preferences enable row level security;

create policy user_ai_preferences_select_own on public.user_ai_preferences
  for select using (auth.uid() = user_id);
create policy user_ai_preferences_insert_own on public.user_ai_preferences
  for insert with check (auth.uid() = user_id);
create policy user_ai_preferences_update_own on public.user_ai_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy user_ai_preferences_delete_own on public.user_ai_preferences
  for delete using (auth.uid() = user_id);

-- Reuses migration 074's touch_updated_at() -- ships with it from the
-- start, same discipline 141/142/153/156 already followed for a genuinely
-- mutated table (a user changing their provider/tier choice IS an update,
-- not an append).
create trigger user_ai_preferences_touch_updated_at
  before update on public.user_ai_preferences for each row execute function public.touch_updated_at();
