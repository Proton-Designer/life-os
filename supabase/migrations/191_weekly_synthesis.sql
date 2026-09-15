-- 191: Weekly synthesis job (Phase 2 #P2-03, Team A / Sonnet ENG 2).
--
-- Two new tables for the two artifacts a single weekly cron job produces,
-- one row per user per Sun-Sat week (`week_start`, matching
-- lib/weekly-review/week-range.ts's own Sunday-start convention) --
-- deliberately two single-responsibility tables, not one, matching this
-- schema's own established convention (ai_morning_briefs/
-- due_card_notification_log/book_ready_notification_log are each scoped to
-- exactly one artifact): the two recaps serve different screens
-- (CollegeOS's Weekly Review vs. Self-Mastery) and have entirely different
-- write shapes (one is an AI-generated claim/fill/release, the other a
-- pure computed insert).
--
-- No begin;/commit; -- the runner owns the transaction.

-- 1) CollegeOS's AI weekly narrative -- same claim-first shape as
-- ai_morning_briefs (migration 182): INSERT claims the slot BEFORE the
-- gatewayChat call, UPDATE fills it in on success, DELETE releases it on
-- no-key/cap-hit/failure so a later tick this week can retry. A row
-- existing at all means "a narrative was successfully generated" -- the
-- reader never has to distinguish "not generated yet" from "generated with
-- no content."
create table public.collegeos_weekly_narratives (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start   date not null,
  narrative_text text,
  provider     text,
  model        text,
  generated_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint collegeos_weekly_narratives_user_week_key unique (user_id, week_start)
);

comment on table public.collegeos_weekly_narratives is
  'P2-03''s CollegeOS AI weekly narrative, one row per user per Sun-Sat week (week_start). Claimed via INSERT before the gatewayChat call, filled via UPDATE on success, DELETEd on failure/no-key/cap-hit so a later tick this week can retry -- see lib/weekly-review/weekly-narrative.ts''s own header.';

alter table public.collegeos_weekly_narratives enable row level security;

create policy collegeos_weekly_narratives_select_own on public.collegeos_weekly_narratives
  for select using (user_id = (select auth.uid()));

-- 2) ULM's weekly recap -- pure computation (no AI call, no claim/release
-- dance needed: nothing expensive to protect against retrying). Book
-- references are nullable (no books, or no book has any review history
-- yet) and composite-tenancy (user_id, book_id) -> books(user_id, id),
-- column-scoped ON DELETE SET NULL (a deleted book must not delete the
-- historical week's numbers, per 129/140's sweep) -- the denormalized
-- *_title columns keep the recap readable even after that happens.
create table public.ulm_weekly_recaps (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start            date not null,
  overall_retention_pct numeric(5, 2) not null check (overall_retention_pct >= 0 and overall_retention_pct <= 100),
  trend                 text not null check (trend in ('up', 'down', 'flat', 'no_data')),
  strongest_book_id     uuid,
  strongest_book_title  text,
  weakest_book_id       uuid,
  weakest_book_title    text,
  created_at            timestamptz not null default now(),
  constraint ulm_weekly_recaps_user_week_key unique (user_id, week_start),
  constraint ulm_weekly_recaps_strongest_book_same_user
    foreign key (user_id, strongest_book_id) references public.books (user_id, id)
    on delete set null (strongest_book_id),
  constraint ulm_weekly_recaps_weakest_book_same_user
    foreign key (user_id, weakest_book_id) references public.books (user_id, id)
    on delete set null (weakest_book_id)
);

comment on table public.ulm_weekly_recaps is
  'P2-03''s ULM weekly recap (retention trend, strongest/weakest book), one row per user per Sun-Sat week (week_start). Pure computed snapshot -- no AI call. "trend" compares this week''s overall_retention_pct against the PRIOR stored row (week_start - 7), not a live recomputation -- see lib/self-mastery/weekly-retention-recap.ts''s own header.';

alter table public.ulm_weekly_recaps enable row level security;

create policy ulm_weekly_recaps_select_own on public.ulm_weekly_recaps
  for select using (user_id = (select auth.uid()));

do $$
declare
  v_narratives_cols int;
  v_narratives_key int;
  v_recaps_cols int;
  v_recaps_key int;
  v_strongest_fk int;
  v_weakest_fk int;
  v_rls_narratives boolean;
  v_rls_recaps boolean;
  v_write_policy_narratives boolean;
  v_write_policy_recaps boolean;
begin
  select count(*) into v_narratives_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'collegeos_weekly_narratives'
     and column_name in ('id','user_id','week_start','narrative_text','provider','model','generated_at','created_at');
  if v_narratives_cols <> 8 then
    raise exception '191: collegeos_weekly_narratives expected 8 known columns, found %', v_narratives_cols;
  end if;

  select count(*) into v_narratives_key from pg_constraint
   where conname = 'collegeos_weekly_narratives_user_week_key' and contype = 'u';
  if v_narratives_key <> 1 then
    raise exception '191: collegeos_weekly_narratives_user_week_key is absent -- no per-week ceiling/lock';
  end if;

  select relrowsecurity into v_rls_narratives from pg_class where relname = 'collegeos_weekly_narratives' and relnamespace = 'public'::regnamespace;
  if not coalesce(v_rls_narratives, false) then
    raise exception '191: RLS not enabled on collegeos_weekly_narratives';
  end if;

  select bool_or(cmd in ('INSERT','UPDATE','DELETE') and 'authenticated' = any(roles))
    into v_write_policy_narratives
    from pg_policies where schemaname='public' and tablename='collegeos_weekly_narratives';
  if coalesce(v_write_policy_narratives, false) then
    raise exception '191: collegeos_weekly_narratives has a write policy for authenticated -- must be select-only, service-role writes only';
  end if;

  select count(*) into v_recaps_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'ulm_weekly_recaps'
     and column_name in ('id','user_id','week_start','overall_retention_pct','trend','strongest_book_id','strongest_book_title','weakest_book_id','weakest_book_title','created_at');
  if v_recaps_cols <> 10 then
    raise exception '191: ulm_weekly_recaps expected 10 known columns, found %', v_recaps_cols;
  end if;

  select count(*) into v_recaps_key from pg_constraint
   where conname = 'ulm_weekly_recaps_user_week_key' and contype = 'u';
  if v_recaps_key <> 1 then
    raise exception '191: ulm_weekly_recaps_user_week_key is absent -- no per-week ceiling/lock';
  end if;

  select count(*) into v_strongest_fk from pg_constraint
   where conname = 'ulm_weekly_recaps_strongest_book_same_user' and contype = 'f'
     and pg_get_constraintdef(oid) ~ 'FOREIGN KEY \(user_id, strongest_book_id\) REFERENCES books\(user_id, id\)';
  if v_strongest_fk <> 1 then
    raise exception '191: ulm_weekly_recaps_strongest_book_same_user composite tenancy FK missing or wrong';
  end if;

  select count(*) into v_weakest_fk from pg_constraint
   where conname = 'ulm_weekly_recaps_weakest_book_same_user' and contype = 'f'
     and pg_get_constraintdef(oid) ~ 'FOREIGN KEY \(user_id, weakest_book_id\) REFERENCES books\(user_id, id\)';
  if v_weakest_fk <> 1 then
    raise exception '191: ulm_weekly_recaps_weakest_book_same_user composite tenancy FK missing or wrong';
  end if;

  select relrowsecurity into v_rls_recaps from pg_class where relname = 'ulm_weekly_recaps' and relnamespace = 'public'::regnamespace;
  if not coalesce(v_rls_recaps, false) then
    raise exception '191: RLS not enabled on ulm_weekly_recaps';
  end if;

  select bool_or(cmd in ('INSERT','UPDATE','DELETE') and 'authenticated' = any(roles))
    into v_write_policy_recaps
    from pg_policies where schemaname='public' and tablename='ulm_weekly_recaps';
  if coalesce(v_write_policy_recaps, false) then
    raise exception '191: ulm_weekly_recaps has a write policy for authenticated -- must be select-only, service-role writes only';
  end if;

  raise notice '191 verified: collegeos_weekly_narratives + ulm_weekly_recaps present, one-per-user-per-week locks are unique indexes, composite tenancy FKs on both book references, RLS select-only for the owning user on both tables';
end $$;
