-- 175 — `identity_habits` + `habit_votes` (#39/#40/#41, Phase 1 ritual-layer
-- core). NEW TABLES, per the architect's ruling (design sent to team-lead,
-- ruled 2026-09-14) — NOT a reshape of `custom_habits` or `deen_habits`.
--
-- WHY NOT `custom_habits`, TWO INDEPENDENT REASONS (either is sufficient):
--   1. `domain text CHECK IN ('deen','fitness')` (000_baseline.sql) is closed,
--      not open-ended — "identity habit" isn't a third domain, it's a
--      different KIND of habit (an identity statement + a vote log replayed
--      into a decaying score) that happens to be cross-domain by design.
--   2. It has a live writer today: app/(app)/fitness/actions.ts:16 addHabit()
--      inserts `domain='fitness'` rows the Fitness UI renders as a plain
--      boolean-per-day checklist (`habit_logs`). Widening the CHECK and
--      bolting on identity/vote/decay columns is the exact "same table, two
--      meanings" trap migration 165's own header calls out for
--      `weekly_goals` — Fitness's reader has zero expectation of a vote log.
--
-- WHY NOT `deen_habits`: Faith-scoped by construction (000_baseline.sql),
-- 69 live rows, already carries its own mature and UNRELATED
-- stage-formation mechanic (`stage_override`: active_build/stabilized/
-- locked — lib/deen/habit-stage.ts, habit-streak.ts, habit-consistency.ts,
-- rendered on /deen). Grafting a cross-domain identity/vote/decay concept
-- onto it would contaminate a working Faith feature.
--
-- Neither existing table's SHAPE fits regardless: the spec needs an
-- append-only per-day vote LOG that a pure function replays into a decaying
-- score (lib/habits/decay-score.ts, application code, no stored score
-- anywhere) — not a boolean completion flag. A third habit concept in the
-- schema is accepted deliberately here, in exchange for zero contamination
-- of either existing feature's readers.
--
-- THE 7-CAP IS AN INDEX, NOT THE UI (same discipline as migration 113's
-- `tasks_mit_rank_per_day_idx` and 165's `goals_rank_per_month_idx`):
-- `identity_habits_rank_per_user_idx`, unique on `(user_id, rank) WHERE
-- status = 'active'`. Seven is scarce because the database refuses an
-- eighth active rank in [1,7], not because a form only draws seven rows.
-- Scoped to `status = 'active'` so archiving a habit releases its rank for
-- a new one — a dropped habit keeping its old rank forever would eventually
-- make every rank permanently unavailable (same reasoning 165 gives for its
-- own ceiling).
--
-- VOTES ARE TOGGLE-DELETE, NOT AN APPEND-ONLY LOG (ruled): a tap with no row
-- for (user, habit, today) inserts; a tap with a row present deletes it.
-- `habit_votes_user_habit_date_key` — unique on `(user_id, habit_id, date)`
-- — makes "two votes same day" unrepresentable and IS the "one vote per
-- habit per local day" rule, not a safeguard on top of it. Application code
-- (lib/habits/actions-core.ts, written in the app-code slice of this work)
-- is responsible for rejecting a vote/retraction for any `date` other than
-- the caller's own `localDateString(now, tz)` — retroactive votes would
-- turn an identity mechanic into a checklist editable to make the number
-- look good, which is exactly the recording-not-deciding pattern this
-- product rejects. That rule is enforced in the server action, not here:
-- the database cannot know "the caller's local today" without being handed
-- it, and a CHECK against `now()` would assume UTC.
--
-- `date` HAS NO FOREIGN KEY TO ANYTHING — it is a plain local calendar date
-- string, same shape as `deen_habit_logs.date` and `distraction_events.date`
-- elsewhere in this schema.
--
-- THE DECAY SCORE IS NEVER STORED ANYWHERE. lib/habits/decay-score.ts
-- replays it from `habit_votes` on every read: `score_d = score_{d-1} *
-- 0.96 + (voted_d ? 0.04 : 0)`, starting at 0 — algebraically `0.04 * sum
-- over each vote of 0.96^(days since that vote)`, computed in closed form
-- over the vote rows rather than a day-by-day loop. This is the entire
-- point of #41 per the source spec: a score that can silently freeze is
-- not derived, and nothing here can freeze because nothing here writes one.
--
-- COMPOSITE TENANCY FK, per 058/086/087/100/101/140/165's pattern:
-- `habit_votes_habit_same_user` references `identity_habits (user_id, id)`,
-- not a bare `habit_id -> identity_habits(id)` FK — a single-column FK only
-- proves the habit row exists, never that the caller owns it, since FK
-- checks bypass RLS. `ON DELETE CASCADE` (not SET NULL) is used here, so
-- 140's "scope every SET NULL to its own column" rule does not apply: a
-- cascade drops the whole dependent row, it cannot leave a NOT NULL
-- `user_id` nulled the way an unscoped SET NULL can.
--
-- `identity_habits_user_id_id_key` exists solely as that composite-FK
-- anchor — redundant with the primary key for uniqueness alone, same
-- reasoning as `goals_user_id_id_key` (165).
--
-- No `begin;`/`commit;` — the runner owns the transaction (files >110 that
-- carry their own fail the apply, per migration 111's own history).

create table public.identity_habits (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- "the athlete" — the identity being voted for, not a task description.
  identity_statement text not null check (length(btrim(identity_statement)) > 0),
  rank               smallint not null check (rank between 1 and 7),
  status             text not null default 'active' check (status in ('active', 'archived')),
  archived_at        timestamptz null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- The archival pair: `status = 'archived'` iff `archived_at` is set. Same
  -- move `goals_completion_pair` (165) and `tasks_type_other_label_check`
  -- already use for their own paired fields — makes "archived with no
  -- timestamp" and "has a timestamp but isn't archived" both unrepresentable.
  constraint identity_habits_archived_pair check ((status = 'archived') = (archived_at is not null)),
  -- The composite-FK anchor for habit_votes below.
  constraint identity_habits_user_id_id_key unique (user_id, id)
);

comment on table public.identity_habits is
  'Up to 7 identity-statement habits per user (#39). NOT custom_habits (closed domain CHECK + live Fitness reader) and NOT deen_habits (Faith-scoped stage mechanic) -- see this migration''s header for the full reasoning. The decaying score (#41) is NEVER stored here or anywhere else; lib/habits/decay-score.ts replays it from habit_votes on every read.';
comment on column public.identity_habits.rank is
  'Scarce because identity_habits_rank_per_user_idx (below) refuses an eighth active rank in [1,7], not because any UI only draws seven rows.';
comment on column public.identity_habits.identity_statement is
  'Non-blank, required -- "the athlete," not a task. A habit without an identity behind it is not this table''s subject.';

-- THE SCARCITY CEILING. Partial: scoped to status = 'active' so an archived
-- habit releases its rank for a new one, rather than the rank staying
-- permanently claimed by a habit nobody is voting for anymore.
create unique index identity_habits_rank_per_user_idx
  on public.identity_habits (user_id, rank)
  where status = 'active';

comment on index public.identity_habits_rank_per_user_idx is
  'Makes seven active identity habits per user scarce because the database refuses an eighth -- same discipline as tasks_mit_rank_per_day_idx (113) and goals_rank_per_month_idx (165).';

alter table public.identity_habits enable row level security;

create policy "identity_habits_own_row" on public.identity_habits
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Reuses migration 074's touch_updated_at() -- one definition of "touch,"
-- not a second that can drift (same reuse as migrations 135/136/165).
create trigger identity_habits_touch_updated_at
  before update on public.identity_habits
  for each row execute function public.touch_updated_at();

create table public.habit_votes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id   uuid not null,
  -- LOCAL calendar date the vote applies to -- callers must derive this via
  -- localDateString(now, tz), never a raw Date (AGENTS.md's own hard rule).
  -- No FK: a plain date column, same shape as deen_habit_logs.date and
  -- distraction_events.date elsewhere in this schema.
  date       date not null,
  created_at timestamptz not null default now(),
  -- Composite tenancy FK: a vote whose habit belongs to someone else is
  -- unrepresentable, not merely unlikely (058/086/087/100/101/140/165).
  -- CASCADE, not SET NULL -- 140's "scope every SET NULL" rule is about a
  -- nullified NOT NULL user_id; a cascade removes the whole row instead.
  constraint habit_votes_habit_same_user
    foreign key (user_id, habit_id) references public.identity_habits (user_id, id) on delete cascade,
  -- THIS IS #40's "one vote per habit per local day" rule, not a safeguard
  -- on top of it -- a second vote for the same (user, habit, date) has no
  -- legal row to occupy.
  constraint habit_votes_user_habit_date_key unique (user_id, habit_id, date)
);

comment on table public.habit_votes is
  'Append/delete-only per-day vote log (#40). A row = "affirmed this local day." Toggle semantics, ruled 2026-09-14: casting is INSERT, retracting is DELETE of that same row -- votes/retractions are restricted to the caller''s own local today in application code (lib/habits/actions-core.ts), never enforced here, since the database has no notion of "the caller''s local today" without being handed it. lib/habits/decay-score.ts (#41) replays this log into a decaying score on every read; nothing in this table stores a score.';
comment on column public.habit_votes.date is
  'Local calendar date string (localDateString(now, tz)), not a timestamptz slice -- a vote at 11pm local must count for that local day regardless of UTC offset.';

alter table public.habit_votes enable row level security;

create policy "habit_votes_own_row" on public.habit_votes
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

do $$
declare
  v_habits_cols int;
  v_votes_cols int;
  v_rank_idx_partial boolean;
  v_votes_key int;
  v_habits_fk int;
  v_votes_fk int;
  v_habits_rls boolean;
  v_votes_rls boolean;
  v_habits_policies int;
  v_votes_policies int;
  v_trigger int;
begin
  select count(*) into v_habits_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'identity_habits'
     and column_name in ('id','user_id','identity_statement','rank','status','archived_at','created_at','updated_at');
  if v_habits_cols <> 8 then
    raise exception '175: identity_habits expected 8 known columns, found %', v_habits_cols;
  end if;

  select count(*) into v_votes_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'habit_votes'
     and column_name in ('id','user_id','habit_id','date','created_at');
  if v_votes_cols <> 5 then
    raise exception '175: habit_votes expected 5 known columns, found %', v_votes_cols;
  end if;

  select indexdef like '%WHERE (status = ''active''%' into v_rank_idx_partial
    from pg_indexes where schemaname = 'public' and indexname = 'identity_habits_rank_per_user_idx';
  if not coalesce(v_rank_idx_partial, false) then
    raise exception '175: identity_habits_rank_per_user_idx missing or not scoped to status=active -- the 7-habit ceiling would not release on archive';
  end if;

  select count(*) into v_votes_key from pg_constraint
   where conname = 'habit_votes_user_habit_date_key' and contype = 'u';
  if v_votes_key <> 1 then
    raise exception '175: habit_votes_user_habit_date_key is absent -- #40 has no one-vote-per-day rule';
  end if;

  select count(*) into v_habits_fk from pg_constraint
   where conname = 'identity_habits_user_id_id_key' and contype = 'u';
  if v_habits_fk <> 1 then
    raise exception '175: identity_habits_user_id_id_key (composite-FK anchor) is absent';
  end if;

  select count(*) into v_votes_fk from pg_constraint
   where conname = 'habit_votes_habit_same_user' and contype = 'f';
  if v_votes_fk <> 1 then
    raise exception '175: habit_votes_habit_same_user composite FK is absent -- a vote could point at someone else''s habit';
  end if;

  select relrowsecurity into v_habits_rls from pg_class where relname = 'identity_habits' and relnamespace = 'public'::regnamespace;
  select relrowsecurity into v_votes_rls from pg_class where relname = 'habit_votes' and relnamespace = 'public'::regnamespace;
  if not (v_habits_rls and v_votes_rls) then
    raise exception '175: RLS not enabled on both tables (identity_habits=%, habit_votes=%)', v_habits_rls, v_votes_rls;
  end if;

  select count(*) into v_habits_policies from pg_policies where schemaname = 'public' and tablename = 'identity_habits';
  select count(*) into v_votes_policies from pg_policies where schemaname = 'public' and tablename = 'habit_votes';
  if v_habits_policies < 1 or v_votes_policies < 1 then
    raise exception '175: own-row RLS policy missing (identity_habits=%, habit_votes=%)', v_habits_policies, v_votes_policies;
  end if;

  select count(*) into v_trigger from pg_trigger where tgname = 'identity_habits_touch_updated_at';
  if v_trigger <> 1 then
    raise exception '175: identity_habits_touch_updated_at trigger is absent';
  end if;

  raise notice '175 verified: identity_habits + habit_votes present, 7-habit ceiling and one-vote-per-day ceiling both indexes, composite FK, RLS + own-row policies, updated_at trigger on identity_habits';
end $$;
