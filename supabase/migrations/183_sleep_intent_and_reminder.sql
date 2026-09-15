-- P2-05, overnight run 2026-09-15, Sonnet ENG 1 (Team A).
--
-- Three pieces: (1) `sleep_intents` -- a direct user capture ("what time
-- are you sleeping tonight"), SELF-SERVICE RLS (unlike the claim/lock
-- tables below, this is a genuine user input the owner may read/write/
-- clear freely, same posture as e.g. `weekly_goals`); (2) `profiles.
-- sleep_reminder_enabled` -- the on/off toggle, same boolean-flag pattern
-- as `profiles.pin_lock_enabled`; (3) `sleep_reminder_log` -- the cron
-- job's claim/lock table, SAME shape as `due_card_notification_log`
-- (migration 170) and `ai_morning_briefs` (migration 182, this track's own
-- earlier work tonight) -- `unique (user_id, sent_date)` is the actual
-- lock, service-role-only writes.
--
-- No begin;/commit; -- the runner owns the transaction.

create table public.sleep_intents (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  intent_date      date not null,
  -- "HH:MM" local clock time, validated app-side (lib/night-plan/sleep-intent.ts's
  -- isValidBedtime) before it ever reaches this column -- a plain text
  -- column rather than `time` because this is a clock-time the user typed
  -- for THEMSELVES to read back, never used in a UTC-instant calculation
  -- (see this repo's own hard constraint on deriving instants from local
  -- clock strings -- resolveLocalTime is for that; this column isn't).
  intended_bedtime text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sleep_intents_bedtime_format check (intended_bedtime ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint sleep_intents_user_date_key unique (user_id, intent_date)
);

comment on table public.sleep_intents is
  'P2-05: one sleep-intent capture per user per local calendar day ("what time are you sleeping tonight"). Self-service RLS -- the user owns this row directly, unlike the claim/lock tables in this same migration.';

alter table public.sleep_intents enable row level security;

create policy sleep_intents_own_row on public.sleep_intents
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.profiles
  add column sleep_reminder_enabled boolean not null default false;

create table public.sleep_reminder_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sent_date  date not null,
  created_at timestamptz not null default now(),
  constraint sleep_reminder_log_user_date_key unique (user_id, sent_date)
);

comment on table public.sleep_reminder_log is
  'P2-05''s 9:30 PM reminder idempotency ledger -- at most one push per user per local day, enforced by sleep_reminder_log_user_date_key, not in-process memory. Select-only for the owning user; INSERT/UPDATE/DELETE happen exclusively through the service-role cron route (app/api/cron/sleep-reminder/route.ts), same posture as due_card_notification_log (migration 170).';

alter table public.sleep_reminder_log enable row level security;

create policy sleep_reminder_log_select_own on public.sleep_reminder_log
  for select using (user_id = (select auth.uid()));

do $$
declare
  v_intents_cols int;
  v_intents_key int;
  v_intents_rls boolean;
  v_intents_policies int;
  v_profile_col int;
  v_log_cols int;
  v_log_key int;
  v_log_rls boolean;
  v_log_insertable_by_authenticated boolean;
begin
  select count(*) into v_intents_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'sleep_intents'
     and column_name in ('id','user_id','intent_date','intended_bedtime','created_at','updated_at');
  if v_intents_cols <> 6 then
    raise exception '183: sleep_intents expected 6 known columns, found %', v_intents_cols;
  end if;

  select count(*) into v_intents_key from pg_constraint
   where conname = 'sleep_intents_user_date_key' and contype = 'u';
  if v_intents_key <> 1 then
    raise exception '183: sleep_intents_user_date_key is absent -- at most one intent per user per day is not enforced';
  end if;

  select relrowsecurity into v_intents_rls from pg_class where relname = 'sleep_intents' and relnamespace = 'public'::regnamespace;
  if not coalesce(v_intents_rls, false) then
    raise exception '183: RLS not enabled on sleep_intents';
  end if;

  select count(*) into v_intents_policies from pg_policies where schemaname='public' and tablename='sleep_intents';
  if v_intents_policies < 1 then
    raise exception '183: no RLS policy on sleep_intents';
  end if;

  select count(*) into v_profile_col from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name = 'sleep_reminder_enabled';
  if v_profile_col <> 1 then
    raise exception '183: profiles.sleep_reminder_enabled is absent';
  end if;

  select count(*) into v_log_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'sleep_reminder_log'
     and column_name in ('id','user_id','sent_date','created_at');
  if v_log_cols <> 4 then
    raise exception '183: sleep_reminder_log expected 4 known columns, found %', v_log_cols;
  end if;

  select count(*) into v_log_key from pg_constraint
   where conname = 'sleep_reminder_log_user_date_key' and contype = 'u';
  if v_log_key <> 1 then
    raise exception '183: sleep_reminder_log_user_date_key is absent -- no per-day ceiling/lock';
  end if;

  select relrowsecurity into v_log_rls from pg_class where relname = 'sleep_reminder_log' and relnamespace = 'public'::regnamespace;
  if not coalesce(v_log_rls, false) then
    raise exception '183: RLS not enabled on sleep_reminder_log';
  end if;

  select bool_or(cmd in ('INSERT','UPDATE','DELETE') and 'authenticated' = any(roles))
    into v_log_insertable_by_authenticated
    from pg_policies where schemaname='public' and tablename='sleep_reminder_log';
  if coalesce(v_log_insertable_by_authenticated, false) then
    raise exception '183: sleep_reminder_log has a write policy for authenticated -- must be select-only, service-role writes only';
  end if;

  raise notice '183 verified: sleep_intents (self-service), profiles.sleep_reminder_enabled, and sleep_reminder_log (claim-first, select-own) all present';
end $$;
