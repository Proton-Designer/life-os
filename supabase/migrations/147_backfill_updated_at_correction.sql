-- 147: corrects the false history migrations 133/135/136/137/138 wrote.
--
-- THE MISTAKE (mine, recorded here so the next person adding a timestamp
-- column to an existing table does not repeat it): those five migrations
-- added `updated_at timestamptz not null default now()` to existing
-- tables. `default now()` fires once per row at ADD COLUMN time, so every
-- row that already existed got stamped with the exact instant the
-- migration ran -- not its own real last-modified time. 138's own header
-- justified skipping a real backfill as "a small honest lie about
-- history... the real mtime is unrecoverable either way." That
-- justification was FALSE for MOST of these tables: they already have
-- `created_at`, and the honest value was sitting right there the whole
-- time; the mistake was reasoning about recoverability instead of
-- checking it, table by table.
--
-- Measured on production before writing this: ~175+ stale rows across
-- the sampled tables alone (deen_habits 61/69, tasks 54/77, profiles
-- 17/21, classes 15/16, kill_list_items 8/11, sunnah_logs 6/7,
-- distraction_triggers 6/6, coop_targets 4/4, exercises 4/4) -- every
-- pre-existing row in each of those tables at the time its own migration
-- ran, claiming it was "last modified" at a moment nothing about it
-- actually changed.
--
-- ============================================================
-- THREE TABLES ARE DELIBERATELY EXCLUDED, FOUND WHILE WRITING THIS, NOT
-- ASSUMED FROM THE LEAD'S OWN TABLE LIST: `adhkar_logs`, `deen_habit_logs`,
-- and `user_settings` have NO `created_at` COLUMN AT ALL -- checked
-- against both the baseline schema (000_baseline.sql: neither
-- adhkar_logs nor deen_habit_logs was ever created with one) and every
-- later migration (confirmed no ALTER ever added one; 133 added ONLY
-- `updated_at` to the first two, 137 added ONLY `updated_at` to
-- user_settings). For these three specific tables, 138's original
-- "unrecoverable either way" reasoning is actually TRUE -- there is no
-- honest value to move `updated_at` back to, and this migration leaves
-- them exactly as they are rather than fabricate one. This narrows the
-- lead's own listed scope by three tables; flagged rather than silently
-- matched to the full list, and reported back before this was applied.
-- ============================================================
--
-- THE FIX IS PRECISELY TARGETABLE, for the 21 tables that DO have
-- `created_at`, because `now()` is constant within a transaction: each
-- backfill migration left ONE identical timestamp shared by every row it
-- touched. A row genuinely modified since carries its own distinct,
-- later value. The predicate below requires ALL THREE:
--   1. `updated_at` equals the value shared by the LARGEST group of rows
--      in that table (the bulk stamp, found by GROUP BY/COUNT, not
--      assumed from the migration's own applied_at alone).
--   2. that value is within 60 SECONDS of the table's own backfill
--      migration's `applied_at` (migration_ledger) -- this is what makes
--      the fix SAFE rather than merely clever: condition 1 alone could,
--      in principle, match a genuine bulk UPDATE some real feature
--      performed; requiring BOTH means matching a SPECIFIC KNOWN EVENT
--      (the backfill), not just "many rows share a value." Proven to
--      matter, not merely reasoned about: tested against a scratch
--      Postgres with a row updated 5 seconds after its migration's own
--      applied_at (so well within the 60s window) that still gets
--      correctly EXCLUDED, because it doesn't share the bulk group's
--      exact value -- condition 1 is pulling real weight, not condition
--      2 alone.
--   3. `created_at < updated_at` -- never move a row's marker BACKWARDS
--      past its own creation, and (see below) the mechanism that makes a
--      second run of this file a true no-op.
-- Matching rows: `updated_at := created_at`.
--
-- THE TRIGGER TRAP, HIT DELIBERATELY, NOT DISCOVERED IN PRODUCTION:
-- `touch_updated_at()` (migration 074) is `BEFORE UPDATE ... new.updated_at
-- := now()`, UNCONDITIONALLY, on every UPDATE to these tables regardless
-- of whether the SET clause named updated_at explicitly. A naive
-- `update ... set updated_at = created_at` on any of these tables would
-- have the trigger immediately overwrite it back to now() -- achieving
-- the EXACT OPPOSITE of this fix, silently (the UPDATE reports success;
-- the value it wrote was already invalid by the time the statement
-- finished).
--
-- TWO WAYS TO neutralize this, both considered:
--   (a) `set local session_replication_role = replica;` for the
--       transaction -- disables ALL triggers (and FK checks) session-
--       wide, auto-reverts at commit/rollback, no per-table bookkeeping.
--       REJECTED: changing session_replication_role requires SUPERUSER
--       in Postgres. Every other migration this program has shipped
--       (133-146) only ever needed table-owner-level DDL (ADD COLUMN,
--       CREATE TRIGGER, CREATE POLICY) -- none of them prove the
--       migration-applying role holds superuser, and this fix has no
--       reason to be the first migration that requires it. It is also a
--       WIDER blast radius than necessary: it would disable triggers on
--       every table in the database for the duration, not just the ones
--       in scope.
--   (b) `alter table <t> disable trigger <t>_touch_updated_at;` /
--       `... enable trigger ...;` bracketing each table's own UPDATE,
--       scoped to exactly the table and trigger in question.
--       CHOSEN: requires only the same table-ownership-level privilege
--       133-146 already exercise successfully (no new assumption about
--       the role), and touches only the tables actually in scope. DDL is
--       transactional in Postgres, so if this file's own transaction
--       rolls back for any reason, the DISABLE is rolled back with it --
--       there is no window where a trigger is left disabled by a failed
--       apply. The ENABLE for each table is written immediately after
--       that table's own UPDATE, in the same file, so a successful
--       commit always re-enables everything it disabled.
--
-- WHY THIS IS IDEMPOTENT, VERIFIED AGAINST A SCRATCH POSTGRES, NOT
-- ASSUMED: after the first run, every previously-stale row has
-- `updated_at = created_at`, so condition 3 (`created_at < updated_at`)
-- is now FALSE for it -- a strict inequality, not `<=`. A second run's
-- GROUP BY could in principle find a NEW "most common" value among the
-- now-scattered timestamps, but condition 2 is the actual safety net
-- here: that new value would have to coincidentally fall within 60
-- seconds of the SAME, now long-past, historical `applied_at` recorded
-- in migration_ledger. Ran this file TWICE against a local scratch
-- Postgres seeded with three tables (one per affected migration: a
-- deen_habits/sunnah_logs stand-in for 133, a coop_targets stand-in for
-- 135), each with a bulk-stamped majority and one genuinely-updated row:
-- first run corrected exactly the bulk rows and left the genuine ones
-- untouched (confirmed `created_at = updated_at` only on the corrected
-- rows, triggers re-enabled after -- `pg_trigger.tgenabled = 'O'` on all
-- three); second run changed ZERO rows (every table reported "no
-- backfill stamp detected," not a single UPDATE), confirmed by
-- re-querying the data unchanged, not merely trusting the log lines.
-- Also dry-run-verified against apply-migration.sh itself (against the
-- same local scratch, never production): passes every refusal gate (no
-- begin;/commit;, nothing non-transactable), and the script's own object
-- manifest correctly lists every ALTER TABLE this file performs --
-- confirms the "write each table's block with the table name literal,
-- never via EXECUTE/format()" choice below actually works with that
-- tooling, not just in theory.
--
-- Tables corrected, and the migration each one's own bulk stamp is
-- checked against: sunnah_logs/deen_habits/deen_weekly_focus (133);
-- coop_targets/coop_tasks/kill_list_items/weekly_goals (135);
-- tasks/classes/class_assessments/schedule_events/
-- schedule_event_overrides (136); profiles/distraction_triggers/
-- trigger_action_plans/trigger_plan_outcomes (137); exercises/workouts/
-- workout_plans/body_metrics/fitness_benchmarks (138). 21 tables, not 24
-- -- see the exclusion note above for the other three.
--
-- Each block below is a SEPARATE, self-contained `do $$ ... $$;`, table
-- name and migration filename written LITERALLY (never built via
-- EXECUTE/format()) so apply-migration.sh's own object-manifest grep --
-- which parses literal `alter|create|drop` text, not dynamic SQL strings
-- -- can still see and print every ALTER TABLE this file performs before
-- it runs. A generic loop over a table array would have been shorter but
-- would have hidden exactly the DDL that manifest exists to surface.
--
-- Reports via `raise notice`, not a `raise exception` assertion: the
-- real per-table stale counts vary and weren't all independently
-- re-derived here beyond the sample above, so a hardcoded expected-count
-- assertion would risk being wrong in a way a plain, honest count is not
-- -- same posture migration 112's own backfill script took, recording a
-- result rather than asserting a predicted one.
--
-- No begin;/commit; -- the runner (apply-migration.sh) owns the
-- transaction.

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.sunnah_logs group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '133_deen_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.sunnah_logs disable trigger sunnah_logs_touch_updated_at;
    update public.sunnah_logs set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.sunnah_logs enable trigger sunnah_logs_touch_updated_at;
    raise notice '147: sunnah_logs -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: sunnah_logs -- no backfill stamp detected within 60s of 133_deen_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.deen_habits group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '133_deen_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.deen_habits disable trigger deen_habits_touch_updated_at;
    update public.deen_habits set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.deen_habits enable trigger deen_habits_touch_updated_at;
    raise notice '147: deen_habits -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: deen_habits -- no backfill stamp detected within 60s of 133_deen_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.deen_weekly_focus group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '133_deen_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.deen_weekly_focus disable trigger deen_weekly_focus_touch_updated_at;
    update public.deen_weekly_focus set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.deen_weekly_focus enable trigger deen_weekly_focus_touch_updated_at;
    raise notice '147: deen_weekly_focus -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: deen_weekly_focus -- no backfill stamp detected within 60s of 133_deen_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.coop_targets group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '135_work_business_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.coop_targets disable trigger coop_targets_touch_updated_at;
    update public.coop_targets set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.coop_targets enable trigger coop_targets_touch_updated_at;
    raise notice '147: coop_targets -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: coop_targets -- no backfill stamp detected within 60s of 135_work_business_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.coop_tasks group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '135_work_business_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.coop_tasks disable trigger coop_tasks_touch_updated_at;
    update public.coop_tasks set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.coop_tasks enable trigger coop_tasks_touch_updated_at;
    raise notice '147: coop_tasks -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: coop_tasks -- no backfill stamp detected within 60s of 135_work_business_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.kill_list_items group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '135_work_business_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.kill_list_items disable trigger kill_list_items_touch_updated_at;
    update public.kill_list_items set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.kill_list_items enable trigger kill_list_items_touch_updated_at;
    raise notice '147: kill_list_items -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: kill_list_items -- no backfill stamp detected within 60s of 135_work_business_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.weekly_goals group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '135_work_business_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.weekly_goals disable trigger weekly_goals_touch_updated_at;
    update public.weekly_goals set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.weekly_goals enable trigger weekly_goals_touch_updated_at;
    raise notice '147: weekly_goals -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: weekly_goals -- no backfill stamp detected within 60s of 135_work_business_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.tasks group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '136_school_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.tasks disable trigger tasks_touch_updated_at;
    update public.tasks set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.tasks enable trigger tasks_touch_updated_at;
    raise notice '147: tasks -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: tasks -- no backfill stamp detected within 60s of 136_school_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.classes group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '136_school_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.classes disable trigger classes_touch_updated_at;
    update public.classes set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.classes enable trigger classes_touch_updated_at;
    raise notice '147: classes -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: classes -- no backfill stamp detected within 60s of 136_school_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.class_assessments group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '136_school_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.class_assessments disable trigger class_assessments_touch_updated_at;
    update public.class_assessments set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.class_assessments enable trigger class_assessments_touch_updated_at;
    raise notice '147: class_assessments -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: class_assessments -- no backfill stamp detected within 60s of 136_school_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.schedule_events group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '136_school_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.schedule_events disable trigger schedule_events_touch_updated_at;
    update public.schedule_events set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.schedule_events enable trigger schedule_events_touch_updated_at;
    raise notice '147: schedule_events -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: schedule_events -- no backfill stamp detected within 60s of 136_school_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.schedule_event_overrides group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '136_school_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.schedule_event_overrides disable trigger schedule_event_overrides_touch_updated_at;
    update public.schedule_event_overrides set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.schedule_event_overrides enable trigger schedule_event_overrides_touch_updated_at;
    raise notice '147: schedule_event_overrides -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: schedule_event_overrides -- no backfill stamp detected within 60s of 136_school_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.profiles group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '137_cross_cutting_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.profiles disable trigger profiles_touch_updated_at;
    update public.profiles set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.profiles enable trigger profiles_touch_updated_at;
    raise notice '147: profiles -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: profiles -- no backfill stamp detected within 60s of 137_cross_cutting_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.distraction_triggers group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '137_cross_cutting_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.distraction_triggers disable trigger distraction_triggers_touch_updated_at;
    update public.distraction_triggers set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.distraction_triggers enable trigger distraction_triggers_touch_updated_at;
    raise notice '147: distraction_triggers -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: distraction_triggers -- no backfill stamp detected within 60s of 137_cross_cutting_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.trigger_action_plans group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '137_cross_cutting_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.trigger_action_plans disable trigger trigger_action_plans_touch_updated_at;
    update public.trigger_action_plans set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.trigger_action_plans enable trigger trigger_action_plans_touch_updated_at;
    raise notice '147: trigger_action_plans -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: trigger_action_plans -- no backfill stamp detected within 60s of 137_cross_cutting_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.trigger_plan_outcomes group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '137_cross_cutting_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.trigger_plan_outcomes disable trigger trigger_plan_outcomes_touch_updated_at;
    update public.trigger_plan_outcomes set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.trigger_plan_outcomes enable trigger trigger_plan_outcomes_touch_updated_at;
    raise notice '147: trigger_plan_outcomes -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: trigger_plan_outcomes -- no backfill stamp detected within 60s of 137_cross_cutting_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.exercises group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '138_fitness_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.exercises disable trigger exercises_touch_updated_at;
    update public.exercises set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.exercises enable trigger exercises_touch_updated_at;
    raise notice '147: exercises -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: exercises -- no backfill stamp detected within 60s of 138_fitness_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.workouts group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '138_fitness_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.workouts disable trigger workouts_touch_updated_at;
    update public.workouts set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.workouts enable trigger workouts_touch_updated_at;
    raise notice '147: workouts -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: workouts -- no backfill stamp detected within 60s of 138_fitness_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.workout_plans group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '138_fitness_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.workout_plans disable trigger workout_plans_touch_updated_at;
    update public.workout_plans set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.workout_plans enable trigger workout_plans_touch_updated_at;
    raise notice '147: workout_plans -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: workout_plans -- no backfill stamp detected within 60s of 138_fitness_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.body_metrics group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '138_fitness_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.body_metrics disable trigger body_metrics_touch_updated_at;
    update public.body_metrics set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.body_metrics enable trigger body_metrics_touch_updated_at;
    raise notice '147: body_metrics -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: body_metrics -- no backfill stamp detected within 60s of 138_fitness_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

do $$
declare
  v_stale_value timestamptz;
  v_stale_count int;
  v_applied_at timestamptz;
  v_rows int;
begin
  select updated_at, count(*) into v_stale_value, v_stale_count
    from public.fitness_benchmarks group by updated_at order by count(*) desc, updated_at asc limit 1;
  select applied_at into v_applied_at from public.migration_ledger where filename = '138_fitness_updated_at.sql';

  if v_stale_value is not null and v_applied_at is not null
     and abs(extract(epoch from (v_stale_value - v_applied_at))) <= 60 then
    alter table public.fitness_benchmarks disable trigger fitness_benchmarks_touch_updated_at;
    update public.fitness_benchmarks set updated_at = created_at where updated_at = v_stale_value and created_at < updated_at;
    get diagnostics v_rows = row_count;
    alter table public.fitness_benchmarks enable trigger fitness_benchmarks_touch_updated_at;
    raise notice '147: fitness_benchmarks -- corrected % row(s) (stale stamp %)', v_rows, v_stale_value;
  else
    raise notice '147: fitness_benchmarks -- no backfill stamp detected within 60s of 138_fitness_updated_at.sql''s applied_at, skipping (stale=%, applied=%)', v_stale_value, v_applied_at;
  end if;
end $$;

