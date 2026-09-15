-- P2-02, overnight run 2026-09-15, Sonnet ENG 1 (Team A).
--
-- One row per user per LOCAL calendar day (`brief_date`), holding the
-- nightly cron's AI-generated 3-line morning brief -- same idempotency
-- shape as `due_card_notification_log` (migration 170), reused
-- deliberately rather than reinvented: `unique (user_id, brief_date)` is
-- the actual lock (see lib/ai/morning-brief.ts's own header for the
-- claim-first, not check-then-write, race discipline this enables), and
-- `brief_date` is computed by the caller from `localDateString(now, tz)` --
-- the user's OWN local day, never the server's UTC day.
--
-- CLAIM ROW FIRST, CONTENT FILLED IN AFTER (unlike 170, where the claim
-- row and its "payload" are the same tiny thing): `brief_text`/`provider`/
-- `model`/`generated_at` all start NULL at INSERT time (the claim), and
-- get UPDATEd once `gatewayChat` actually returns content. A claim that
-- never gets filled in (no key, cap hit, a genuine provider failure) is
-- DELETED by the caller rather than left as a null-content row -- so a
-- row existing at all means "a brief was successfully generated," and
-- Home's own reader (`getMorningBriefForToday`) never has to distinguish
-- "not generated yet" from "generated with no content."
--
-- RLS: SELECT-only for the owning user (Home's own read), same posture
-- as 170/145/130's identical-shape logs cited in migration 170's own
-- header. INSERT/UPDATE/DELETE happen exclusively through the
-- service-role cron route (app/api/cron/nightly-morning-brief/route.ts).
--
-- No begin;/commit; -- the runner owns the transaction.

create table public.ai_morning_briefs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  brief_date   date not null,
  brief_text   text,
  provider     text,
  model        text,
  generated_at timestamptz,
  created_at   timestamptz not null default now(),
  -- THE CEILING AND THE LOCK: at most one row per user per local day,
  -- claimed via INSERT before the expensive gatewayChat call. See this
  -- migration's header and lib/ai/morning-brief.ts's own header.
  constraint ai_morning_briefs_user_date_key unique (user_id, brief_date)
);

comment on table public.ai_morning_briefs is
  'P2-02''s nightly AI morning brief, one row per user per local calendar day. Claimed via INSERT (unique (user_id, brief_date)) BEFORE the gatewayChat call, filled in via UPDATE on success, DELETEd on failure/no-key/cap-hit so the next cron tick can retry -- see lib/ai/morning-brief.ts''s own header.';

alter table public.ai_morning_briefs enable row level security;

create policy ai_morning_briefs_select_own on public.ai_morning_briefs
  for select using (user_id = (select auth.uid()));

do $$
declare
  v_cols int;
  v_key int;
  v_rls boolean;
  v_policies int;
  v_insertable_by_authenticated boolean;
begin
  select count(*) into v_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'ai_morning_briefs'
     and column_name in ('id','user_id','brief_date','brief_text','provider','model','generated_at','created_at');
  if v_cols <> 8 then
    raise exception '182: ai_morning_briefs expected 8 known columns, found %', v_cols;
  end if;

  select count(*) into v_key from pg_constraint
   where conname = 'ai_morning_briefs_user_date_key' and contype = 'u';
  if v_key <> 1 then
    raise exception '182: ai_morning_briefs_user_date_key is absent -- P2-02 has no per-day ceiling/lock';
  end if;

  select relrowsecurity into v_rls from pg_class where relname = 'ai_morning_briefs' and relnamespace = 'public'::regnamespace;
  if not coalesce(v_rls, false) then
    raise exception '182: RLS not enabled on ai_morning_briefs';
  end if;

  select count(*) into v_policies from pg_policies where schemaname='public' and tablename='ai_morning_briefs';
  if v_policies < 1 then
    raise exception '182: no RLS policy on ai_morning_briefs';
  end if;

  select bool_or(cmd in ('INSERT','UPDATE','DELETE') and 'authenticated' = any(roles))
    into v_insertable_by_authenticated
    from pg_policies where schemaname='public' and tablename='ai_morning_briefs';
  if coalesce(v_insertable_by_authenticated, false) then
    raise exception '182: ai_morning_briefs has a write policy for authenticated -- must be select-only, service-role writes only';
  end if;

  raise notice '182 verified: ai_morning_briefs present, one-per-user-per-day claim/lock is a unique index, RLS select-only for the owning user';
end $$;
