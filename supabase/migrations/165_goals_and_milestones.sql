-- 165 — `goals` and `goal_milestones` (#43/#44). NEW TABLES, per the
-- architect's ruling — NOT a reshape of `weekly_goals`. NUMBER PROPOSED BY
-- THE S4 TRACK, PENDING THE LEAD'S ALLOCATION (R5: "Numbers are allocated by
-- the LifeOS lead only") — do not apply until the lead confirms 165 is
-- actually free and assigns it for real. This track originally proposed
-- 157, which collided with another track's migrations 157-161 landing in
-- this same shared working tree while this file was being written; 165
-- leaves headroom, but only the lead's allocation is authoritative.
--
-- WHY NOT `weekly_goals`, FIVE INDEPENDENT REASONS (any one is sufficient):
--   1. Its unique key `(user_id, week_start_date, domain)` IS the current
--      2-goal cap (one row per domain per week) — every writer upserts on
--      it, so widening it to a 5-goal ranked portfolio is not a migration,
--      it is replacing the table's identity.
--   2. Nine live call sites read it today, all expecting "this week's
--      headline for a domain" — none of them expect a rank or a scarcity
--      ceiling.
--   3. `domain text CHECK IN ('deen','business')` guards an MCP
--      `fixedFilter` (`lib/mcp`) — widening the CHECK changes what that
--      filter admits, silently, for a tool that already ships.
--   4. `milestones jsonb DEFAULT '[]'` is a flat, unindexed array — `[]` in
--      all 5 production rows today. #44's scarcity ("one unfinished
--      milestone per goal per month" via `UNIQUE (user_id, goal_id,
--      month_start)`) cannot be expressed inside a jsonb array at all.
--   5. They are different objects. `weekly_goals` is "this week's focus per
--      domain." #43 is a ranked, cross-domain, monthly portfolio with a
--      5-goal scarcity ceiling and a required reason. Forcing one table to
--      answer both questions is exactly the "same table, two meanings" trap
--      migration 119's own header already warned against for `tasks.domain`.
--
-- THE CEILING IS AN INDEX, NOT THE UI (same discipline as migration 113's
-- `tasks_mit_rank_per_day_idx` — "the index is the feature"):
--   `goals_rank_per_month_idx`, unique on `(user_id, month_start, rank)
--   WHERE status = 'active'`. Five is scarce because the database refuses a
--   sixth active rank, not because a form only draws five rows. Scoped to
--   `status = 'active'` so completing or dropping a goal releases its rank
--   for a new one — a resolved goal keeping its old rank number forever
--   would eventually make every rank permanently unavailable.
--
-- `goal_milestones.month_start` IS DENORMALISED ONTO THIS TABLE ON PURPOSE.
-- #45 (Night Plan seeding) queries "unfinished milestones for this month" on
-- its own, on a schedule the Night Plan controls (every close), and must not
-- join `goals` to get there — a join here would mean the seeding query's
-- cost and correctness depend on `goals`' own indexing/RLS shape rather than
-- standing on one table. It also makes #44's uniqueness
-- (`UNIQUE (user_id, goal_id, month_start)`) a single-table index instead of
-- a cross-table constraint, which Postgres cannot express directly anyway.
--
-- `UNIQUE (user_id, id)` ON `goals` EXISTS SOLELY AS THE COMPOSITE-FK
-- ANCHOR for `goal_milestones (user_id, goal_id) -> goals (user_id, id)` —
-- same cross-tenant-hardening pattern as migrations 058/086/087/100 (a
-- single-column FK bypasses RLS on the write path; the composite FK makes a
-- milestone pointing at someone else's goal unrepresentable rather than
-- merely unlikely).
--
-- `goal_milestones.created_at` IS ADDED THOUGH NOT ITEMIZED IN THE
-- ARCHITECT'S FIELD LIST — every other table in this schema carries one, and
-- #45's seeding query orders unfinished milestones oldest-first, which needs
-- it. No `updated_at`/trigger on this table: not requested, and nothing
-- about a milestone changes in place other than `done_at`, which is already
-- a real timestamp of the one transition that matters.
--
-- No `begin;`/`commit;` — the runner owns the transaction (files >110 that
-- carry their own fail the apply, per migration 111's own history).

create table public.goals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month_start    date not null,
  domain         text null,
  title          text not null check (length(btrim(title)) > 0),
  -- #43's "with reason" — a goal without one is not what this table models.
  reason         text not null check (length(btrim(reason)) > 0),
  rank           smallint not null check (rank between 1 and 5),
  status         text not null default 'active' check (status in ('active', 'done', 'dropped')),
  completed_at   timestamptz null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- A month, not a day: only the 1st is a legal month_start, the same
  -- discipline `weekly_goals.week_start_date` gets from application code
  -- alone today (this states it at the database instead).
  constraint goals_month_start_is_first_of_month check (extract(day from month_start) = 1),
  -- The completion pair: `status = 'done'` iff `completed_at` is set. Makes
  -- "done with no timestamp" and "has a timestamp but isn't done" both
  -- unrepresentable, the same move `tasks.task_type_other_label_check`
  -- already uses for its own paired field.
  constraint goals_completion_pair check ((status = 'done') = (completed_at is not null)),
  -- The composite-FK anchor for goal_milestones below. Redundant with the
  -- primary key for uniqueness alone; exists purely so a composite FK has
  -- something to reference (same pattern as migration 058).
  constraint goals_user_id_id_key unique (user_id, id)
);

comment on table public.goals is
  'A ranked, cross-domain monthly goal portfolio (#43) — NOT weekly_goals, which is "this week''s focus per domain" and cannot express a 5-goal scarcity ceiling or a required reason. See this migration''s header for the five independent reasons a new table was chosen.';
comment on column public.goals.rank is
  'Scarce because goals_rank_per_month_idx (below) refuses a sixth active rank per month, not because any UI only draws five rows.';
comment on column public.goals.reason is
  'Non-blank, required. #43''s "with reason" -- a goal without one is not this table''s subject.';

-- THE SCARCITY CEILING. Partial: scoped to status = 'active' so a completed
-- or dropped goal releases its rank for a new one, rather than the rank
-- staying permanently claimed by a resolved goal.
create unique index goals_rank_per_month_idx
  on public.goals (user_id, month_start, rank)
  where status = 'active';

comment on index public.goals_rank_per_month_idx is
  'Makes five active goals per month scarce because the database refuses a sixth -- the same discipline as tasks_mit_rank_per_day_idx (migration 113) for the crown.';

alter table public.goals enable row level security;

create policy "goals_own_row" on public.goals
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Reuses migration 074's touch_updated_at() -- one definition of "touch",
-- not a second that can drift (same reuse as migration 135).
create trigger goals_touch_updated_at
  before update on public.goals
  for each row execute function public.touch_updated_at();

create table public.goal_milestones (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id        uuid not null,
  -- DENORMALISED ON PURPOSE -- see this migration's header. #45 queries
  -- unfinished milestones for a month directly off this table, and this
  -- also lets #44's uniqueness be a single-table index.
  month_start    date not null,
  title          text not null check (length(btrim(title)) > 0),
  done_at        timestamptz null,
  created_at     timestamptz not null default now(),
  -- The composite-FK: a milestone whose goal belongs to someone else is
  -- unrepresentable, not merely unlikely (see migrations 058/086/087/100).
  constraint goal_milestones_goal_same_user
    foreign key (user_id, goal_id) references public.goals (user_id, id) on delete cascade,
  -- #44 IS THIS INDEX: at most one row per (user, goal, month) -- see the
  -- migration header for why that is the whole feature, not a safeguard on it.
  constraint goal_milestones_user_goal_month_key unique (user_id, goal_id, month_start)
);

comment on table public.goal_milestones is
  '#44''s ceiling IS goal_milestones_user_goal_month_key -- see this migration''s header. month_start is denormalised from goals on purpose: #45''s seeding query reads this table alone, no join.';
comment on column public.goal_milestones.month_start is
  'Denormalised from goals.month_start on purpose -- #45 (Night Plan seeding) queries unfinished milestones for a month without joining goals, and this also makes goal_milestones_user_goal_month_key a single-table index.';

alter table public.goal_milestones enable row level security;

create policy "goal_milestones_own_row" on public.goal_milestones
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

do $$
declare
  v_goals_cols int;
  v_ms_cols int;
  v_rank_idx_partial boolean;
  v_ms_key int;
  v_goals_fk int;
  v_ms_fk int;
  v_goals_rls boolean;
  v_ms_rls boolean;
  v_goals_policies int;
  v_ms_policies int;
  v_trigger int;
begin
  select count(*) into v_goals_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'goals'
     and column_name in ('id','user_id','month_start','domain','title','reason','rank','status','completed_at','created_at','updated_at');
  if v_goals_cols <> 11 then
    raise exception '165: goals expected 11 known columns, found %', v_goals_cols;
  end if;

  select count(*) into v_ms_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'goal_milestones'
     and column_name in ('id','user_id','goal_id','month_start','title','done_at','created_at');
  if v_ms_cols <> 7 then
    raise exception '165: goal_milestones expected 7 known columns, found %', v_ms_cols;
  end if;

  select indexdef like '%WHERE (status = ''active''%' into v_rank_idx_partial
    from pg_indexes where schemaname='public' and indexname='goals_rank_per_month_idx';
  if not coalesce(v_rank_idx_partial, false) then
    raise exception '165: goals_rank_per_month_idx missing or not scoped to status=active -- the 5-goal ceiling would not release on completion/drop';
  end if;

  select count(*) into v_ms_key from pg_constraint
   where conname = 'goal_milestones_user_goal_month_key' and contype = 'u';
  if v_ms_key <> 1 then
    raise exception '165: goal_milestones_user_goal_month_key is absent -- #44 has no ceiling';
  end if;

  select count(*) into v_goals_fk from pg_constraint
   where conname = 'goals_user_id_id_key' and contype = 'u';
  if v_goals_fk <> 1 then
    raise exception '165: goals_user_id_id_key (composite-FK anchor) is absent';
  end if;

  select count(*) into v_ms_fk from pg_constraint
   where conname = 'goal_milestones_goal_same_user' and contype = 'f';
  if v_ms_fk <> 1 then
    raise exception '165: goal_milestones_goal_same_user composite FK is absent -- a milestone could point at someone else''s goal';
  end if;

  select relrowsecurity into v_goals_rls from pg_class where relname = 'goals' and relnamespace = 'public'::regnamespace;
  select relrowsecurity into v_ms_rls from pg_class where relname = 'goal_milestones' and relnamespace = 'public'::regnamespace;
  if not (v_goals_rls and v_ms_rls) then
    raise exception '165: RLS not enabled on both tables (goals=%, goal_milestones=%)', v_goals_rls, v_ms_rls;
  end if;

  select count(*) into v_goals_policies from pg_policies where schemaname='public' and tablename='goals';
  select count(*) into v_ms_policies from pg_policies where schemaname='public' and tablename='goal_milestones';
  if v_goals_policies < 1 or v_ms_policies < 1 then
    raise exception '165: own-row RLS policy missing (goals=%, goal_milestones=%)', v_goals_policies, v_ms_policies;
  end if;

  select count(*) into v_trigger from pg_trigger where tgname = 'goals_touch_updated_at';
  if v_trigger <> 1 then
    raise exception '165: goals_touch_updated_at trigger is absent';
  end if;

  raise notice '165 verified: goals + goal_milestones present, 5-goal ceiling and 1-milestone-per-goal-per-month ceiling both indexes, composite FK, RLS + own-row policies, updated_at trigger on goals';
end $$;
