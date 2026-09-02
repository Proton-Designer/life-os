-- 113 — Night Plan's rank concept on `tasks` (B1).
--
-- Source: lib/night-plan/SPEC.md §1, itself a port of CollegeOS
-- `packages/api/src/day/nightPlan.ts` + its migration `0005`. LifeOS `tasks`
-- has no rank concept at all today — no `mit_rank`, no `planned_date` — so the
-- ported engine (6e33970) currently has nowhere to write. This is that
-- nowhere.
--
-- THE INDEX IS THE FEATURE, NOT A SAFEGUARD ON IT. Crowning is scarce because
-- the database refuses a second crown, not because the surface draws one
-- button. Ship the columns without the index and the failure is SILENT: two
-- crowned items render perfectly and the day quietly stops having a single
-- most important thing. Nobody sees an error, which is the shape of defect
-- this project has now been bitten by five times in one night. The engine
-- holds the same invariant in `crown()` so a bug cannot reach the write, but
-- an engine invariant protects one caller and an index protects the table.
--
-- `mit_rank` IS NULLABLE AND NULL IS A REAL STATE — "written down, not
-- chosen" — not missing data. Do not add a default, do not backfill it, and
-- do not let a reader treat absent as rank 0 or as lowest priority. That
-- confusion (absent read as a value) is the single most expensive bug class
-- on this codebase; see AGENTS.md and R37.
--
-- NOT ENFORCED HERE, AND DELIBERATELY SO: the SPEC's rule that ranks are
-- cleared rather than accumulated ("a task starred on Monday still carries
-- rank 2 on Thursday"). That is the WRITER's job — the night-before ceremony
-- clears stale ranks the way CollegeOS's `submitCheckin` does. A constraint
-- cannot express "ranks belong to the day they were set" without knowing what
-- today is, and Postgres's `current_date` is UTC, which is exactly how this
-- codebase has shipped a day-boundary bug four separate times. The date always
-- arrives from the app layer, computed in the user's timezone.
--
-- No `begin;`/`commit;`: the runner owns the transaction (`--single-transaction`
-- is the default) and refuses files above 110 that carry their own. A file's
-- own `commit;` ends the runner's transaction early, so anything appended
-- below it later runs unprotected while looking covered — the exact cause of
-- migration 111's two failed production applies.

alter table public.tasks
  add column mit_rank smallint check (mit_rank between 1 and 3);

alter table public.tasks
  add column planned_date date;

-- Partial: unique only among rows that actually carry a rank. Without the
-- WHERE clause every unranked task would collide on (user_id, planned_date,
-- null) — or rather would NOT collide, since null is never equal to null in a
-- unique index, which is precisely why the predicate must be explicit rather
-- than relied upon as a side effect of null semantics.
create unique index tasks_mit_rank_per_day_idx
  on public.tasks (user_id, planned_date, mit_rank)
  where mit_rank is not null;

comment on column public.tasks.mit_rank is
  'Night Plan rank 1-3 for planned_date. NULL means "written down, not chosen" -- a real state, never missing data. Cleared by the writer each night, not by any constraint here.';

comment on column public.tasks.planned_date is
  'The local calendar day this task was planned for, computed in the user''s timezone by the app layer. Never derived from current_date, which is UTC.';

comment on index public.tasks_mit_rank_per_day_idx is
  'Makes the crown scarce. Two crowned items would render perfectly and silently cost the day its single most important thing.';

do $$
declare
  v_cols int;
  v_idx int;
  v_partial boolean;
begin
  select count(*) into v_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'tasks'
     and column_name in ('mit_rank', 'planned_date');
  if v_cols <> 2 then
    raise exception 'migration 113: expected both mit_rank and planned_date on tasks, found %', v_cols;
  end if;

  select count(*) into v_idx from pg_indexes
   where schemaname = 'public' and indexname = 'tasks_mit_rank_per_day_idx';
  if v_idx <> 1 then
    raise exception 'migration 113: tasks_mit_rank_per_day_idx is absent -- the crown would not be scarce';
  end if;

  -- Assert the PREDICATE, not merely the index's existence. An index created
  -- without its WHERE clause is still one row in pg_indexes and would let a
  -- second crown through while every existence check reported success.
  select indexdef like '%WHERE (mit_rank IS NOT NULL)%' into v_partial
    from pg_indexes where schemaname = 'public' and indexname = 'tasks_mit_rank_per_day_idx';
  if not v_partial then
    raise exception 'migration 113: tasks_mit_rank_per_day_idx exists but is NOT partial -- it would collide on every unranked task';
  end if;

  raise notice 'migration 113 verified: mit_rank + planned_date present, partial unique index enforcing one crown per user per day';
end $$;
