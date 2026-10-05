-- QURAN-01: the Quran khatm plan. ONE bookmark (current_page = the NEXT page to read, 605 = finished) and the plan
-- parameters; everything else (today's portion, ahead/behind, projected finish, pace) is DERIVED in app code
-- (lib/quran/plan.ts) from these columns plus the reading log. Additive: a new table and nullable columns.
--
-- quran_plans: one row per khatm. `target_date` (finish day, inclusive) XOR `pace_pages_per_day` (the other is derived).
-- The plan is (re)based at plan_set_on / plan_set_page: creating it, "keep the date" and "move the date" all reset that
-- baseline to today + the current bookmark so the remaining pages are re-spread; original_pace_pages_per_day never
-- changes (the "needed pace > 2x the original" nudge compares against it). Pausing sets paused_on; resuming adds the
-- frozen days to paused_days, which are excluded from the expected-page maths. At most ONE open (active or paused)
-- plan per user; finished khatms stay as history (khatm_number counts them).
--
-- quran_sessions += from_page / to_page (the span a plan log covered, 1-604) and plan_id (which khatm it counted
-- toward, so Undo and the per-khatm pace know the row). Old rows keep pages_read and leave the new columns NULL.
-- plan_id is a composite tenancy FK (user_id, plan_id) with ON DELETE SET NULL scoped to plan_id ONLY (a plain SET NULL
-- would also null the NOT NULL user_id and make deleting a plan impossible).
--
-- No begin/commit: apply-migration.sh owns the transaction.

create table public.quran_plans (
  id                           uuid primary key default gen_random_uuid(),
  user_id                      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  khatm_number                 integer not null check (khatm_number >= 1),
  start_date                   date not null,
  start_page                   smallint not null check (start_page between 1 and 604),
  plan_set_on                  date not null,
  plan_set_page                smallint not null check (plan_set_page between 1 and 604),
  target_date                  date null,
  pace_pages_per_day           numeric(6, 2) null check (pace_pages_per_day is null or (pace_pages_per_day > 0 and pace_pages_per_day <= 604)),
  original_pace_pages_per_day  numeric(6, 2) not null check (original_pace_pages_per_day > 0 and original_pace_pages_per_day <= 604),
  current_page                 smallint not null check (current_page between 1 and 605),
  status                       text not null default 'active' check (status in ('active', 'paused', 'completed')),
  paused_on                    date null,
  paused_days                  integer not null default 0 check (paused_days >= 0),
  completed_on                 date null,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  constraint quran_plans_target_xor_pace check ((target_date is not null) <> (pace_pages_per_day is not null)),
  constraint quran_plans_paused_consistent check ((status = 'paused') = (paused_on is not null)),
  constraint quran_plans_completed_consistent check ((status = 'completed') = (completed_on is not null)),
  constraint quran_plans_baseline_check check (plan_set_on >= start_date),
  constraint quran_plans_user_id_id_key unique (user_id, id),
  constraint quran_plans_user_khatm_key unique (user_id, khatm_number)
);

create unique index quran_plans_one_open_per_user on public.quran_plans (user_id) where status in ('active', 'paused');

comment on table public.quran_plans is
  'QURAN-01: one khatm plan. current_page = next page to read (605 = finished). Plan maths is derived in lib/quran/plan.ts; at most one open (active/paused) plan per user.';
comment on column public.quran_plans.target_date is 'Finish day (inclusive). Exactly one of target_date / pace_pages_per_day is set.';
comment on column public.quran_plans.original_pace_pages_per_day is 'The pace the plan was first created with; never changes (the 2x "move the date" nudge compares against it).';

alter table public.quran_plans enable row level security;
create policy quran_plans_select_own on public.quran_plans for select using (auth.uid() = user_id);
create policy quran_plans_insert_own on public.quran_plans for insert with check (auth.uid() = user_id);
create policy quran_plans_update_own on public.quran_plans for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy quran_plans_delete_own on public.quran_plans for delete using (auth.uid() = user_id);

drop trigger if exists quran_plans_touch_updated_at on public.quran_plans;
create trigger quran_plans_touch_updated_at
  before update on public.quran_plans for each row execute function public.touch_updated_at();

alter table public.quran_sessions
  add column from_page smallint null,
  add column to_page   smallint null,
  add column plan_id   uuid     null;

alter table public.quran_sessions
  add constraint quran_sessions_from_page_check check (from_page is null or from_page between 1 and 604),
  add constraint quran_sessions_to_page_check   check (to_page is null or to_page between 1 and 604),
  add constraint quran_sessions_span_check      check (from_page is null or to_page is null or to_page >= from_page),
  add constraint quran_sessions_plan_same_user
    foreign key (user_id, plan_id) references public.quran_plans (user_id, id) on delete set null (plan_id);

create index quran_sessions_user_plan_idx on public.quran_sessions (user_id, plan_id);

comment on column public.quran_sessions.from_page is 'QURAN-01: first page of the span this log covered (1-604). NULL on legacy rows (pages_read only).';
comment on column public.quran_sessions.to_page is 'QURAN-01: last page of the span this log covered (1-604). NULL on legacy rows.';
comment on column public.quran_sessions.plan_id is 'QURAN-01: the khatm plan this log counted toward (composite tenancy FK, ON DELETE SET NULL scoped to this column).';

-- Verification that examines real catalog state (a check that examines nothing reports success).
do $$
declare
  v_n int;
  v_setcols smallint[];
begin
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'quran_sessions' and column_name in ('from_page', 'to_page', 'plan_id'))
       or (table_name = 'quran_plans' and column_name in ('current_page', 'target_date', 'pace_pages_per_day', 'original_pace_pages_per_day', 'plan_set_on', 'plan_set_page', 'paused_on', 'paused_days', 'completed_on', 'khatm_number', 'status')));
  if v_n <> 14 then raise exception 'migration 258: expected 14 new columns, found %', v_n; end if;

  select count(*) into v_n from pg_class where relname = 'quran_plans' and relrowsecurity and relnamespace = 'public'::regnamespace;
  if v_n <> 1 then raise exception 'migration 258: RLS is not enabled on quran_plans'; end if;
  select count(*) into v_n from pg_policies where schemaname = 'public' and tablename = 'quran_plans';
  if v_n <> 4 then raise exception 'migration 258: expected 4 owner-only policies on quran_plans, found %', v_n; end if;

  if to_regclass('public.quran_plans_one_open_per_user') is null then
    raise exception 'migration 258: the one-open-plan-per-user partial unique index is missing';
  end if;
  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and indexname = 'quran_plans_one_open_per_user' and indexdef like '%WHERE%';
  if v_n <> 1 then raise exception 'migration 258: the one-open-plan index is not partial'; end if;

  -- The plan FK must be composite and its SET NULL scoped to plan_id alone.
  select confdelsetcols into v_setcols from pg_constraint
   where conname = 'quran_sessions_plan_same_user' and conrelid = 'public.quran_sessions'::regclass and confdeltype = 'n';
  if v_setcols is null then raise exception 'migration 258: quran_sessions plan FK missing or not ON DELETE SET NULL'; end if;
  if array_length(v_setcols, 1) <> 1 then raise exception 'migration 258: the plan FK SET NULL is not column-scoped (% columns)', array_length(v_setcols, 1); end if;

  select count(*) into v_n from pg_constraint
   where conrelid = 'public.quran_plans'::regclass
     and conname in ('quran_plans_target_xor_pace', 'quran_plans_paused_consistent', 'quran_plans_completed_consistent', 'quran_plans_user_id_id_key', 'quran_plans_user_khatm_key');
  if v_n <> 5 then raise exception 'migration 258: expected 5 named quran_plans constraints, found %', v_n; end if;
end
$$;
