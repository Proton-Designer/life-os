-- 120 — `tasks.dump_source` (R57).
--
-- `119` made `domain` nullable, which says what a dumped item ISN'T. This says
-- what it IS.
--
-- The capture surface (b2f3a6c) had to write worries and notes as
-- domain 'school', because nothing in this table distinguished a parked worry
-- from a note from ordinary class work. They became class work — silently, and
-- irreversibly, since after the write no field remembered otherwise. Eng 1
-- hid worry/note from the picker rather than ship that, which is why there is
-- nothing to clean up: production has 121 tasks, all created between
-- 2026-08-26 and 2026-08-28, and zero in the six hours before this migration
-- was written. Checked, not assumed — see the note on backfilling below.
--
-- lib/night-plan/SPEC.md §4's seeding set (school deliverables, goal
-- milestones, worries) needs the same column, so the Night Plan and the
-- capture surface share one vocabulary rather than inventing two.
--
-- NULLABLE, AND DELIBERATELY NOT BACKFILLED. Every row that exists today
-- predates the concept. Backfilling them to 'school' would be inventing
-- provenance — it would say "the capture surface classified this" about rows
-- created by a form that had no such notion. NULL here means "written before
-- this was recorded", which is a DIFFERENT fact from every listed value and
-- must not be collapsed into one of them. This is the same distinction
-- `domain` NULL and `mit_rank` NULL each carry, and the third column in this
-- table to carry it.
--
-- A CHECK, NOT AN ENUM. The value set will grow — SPEC §4 already anticipates
-- more seeding sources — and widening a CHECK is an ordinary ALTER inside a
-- transaction, while `alter type ... add value` cannot run in one at all
-- (apply-migration.sh's NON_TX_PATTERN exists for exactly that). A column
-- whose vocabulary is expected to change should not be the one that forces a
-- non-transactional apply.
--
-- No `begin;`/`commit;` — the runner owns the transaction.

alter table public.tasks
  add column dump_source text null
  check (dump_source in ('school', 'milestone', 'worry', 'note', 'capture'));

comment on column public.tasks.dump_source is
  'Where this row came from: school | milestone | worry | note | capture. NULL means it predates the column, NOT that it is unclassified -- do not backfill it to a guess. The Night Plan engine''s DumpSource maps from this; a worry stays a worry here even though its domain is NULL.';

do $$
declare
  v_def text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'dump_source'
  ) then
    raise exception 'migration 120: tasks.dump_source is absent';
  end if;

  -- Assert the CHECK and its CONTENTS, not merely that some constraint exists.
  -- A column added without its constraint accepts any string while every
  -- existence-style check still reports success -- the failure shape this
  -- project has met repeatedly tonight, most recently when a non-unique index
  -- with the right name, columns and predicate passed 113's own self-check.
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.tasks'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%dump_source%';

  if v_def is null then
    raise exception 'migration 120: tasks.dump_source has no CHECK -- it would accept any string';
  end if;
  if v_def not like '%worry%' or v_def not like '%milestone%' or v_def not like '%capture%'
     or v_def not like '%note%' or v_def not like '%school%' then
    raise exception 'migration 120: dump_source CHECK does not admit the five expected values: %', v_def;
  end if;

  raise notice 'migration 120 verified: tasks.dump_source present, CHECK = %', v_def;
end $$;
