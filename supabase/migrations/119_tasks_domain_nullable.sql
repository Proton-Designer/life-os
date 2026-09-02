-- 119 — `tasks.domain` becomes NULLABLE (R54).
--
-- The Night Plan's dump has nowhere to write. `tasks.domain` is NOT NULL with
-- a CHECK admitting only 'school' and 'co_op', and the ceremony's own seeding
-- set is risk-ranked school deliverables, unfinished goal milestones and
-- WORRIES. A worry is not school and not co_op, so the plan stage could not
-- persist a dumped line without lying about what it is — and a column whose
-- value is chosen to satisfy a constraint has stopped meaning anything.
--
-- NULLABLE RATHER THAN A WIDER CHECK, and the reason is the same one `113`
-- already settled one column to the left. A dumped item genuinely HAS NO
-- domain yet: it was typed into a two-to-three-minute ritual, and
-- lib/night-plan/SPEC.md is explicit that a category picker on every dumped
-- line is exactly the friction that ends a nightly habit. "Dumped, not
-- categorised" is the same real state as `mit_rank`'s "dumped, not starred".
-- Modelling one as NULL and forcing the other to a sentinel would make the
-- same table answer the same question two different ways.
--
-- Widening the CHECK to the six areas was the alternative. It commits the
-- Night Plan to the area model before onboarding offers it (R27.2), and it
-- still demands an answer at dump time that the ceremony exists not to ask
-- for.
--
-- THE CHECK STAYS. It already constrains only non-null values — SQL CHECK
-- constraints pass on NULL — so 'school' and 'co_op' remain the only legal
-- non-null values and nothing else can appear by accident. Dropping the CHECK
-- alongside the NOT NULL would have quietly opened the column to any string.
--
-- READERS, and what each does with a null domain (R54 requires this stated,
-- not assumed):
--   app/(app)/school/page.tsx      .eq("domain","school")  -> null rows excluded
--   lib/home/get-domain-pulse.ts   .eq("domain","school")  -> null rows excluded
--     Both are correct without change: `domain = 'school'` is NULL, not true,
--     for a null row, so plan items never appear as class work.
--   lib/home/get-priority-items.ts SELECTs domain and types it
--     `"school" | "co_op"`. That type would start lying the moment a real row
--     carries null, so this migration's commit adds an explicit
--     `.not("domain","is",null)` there — plan items are read via
--     planned_date/mit_rank by the Night Plan, never as priority items.
--   app/(app)/school/class-actions.ts writes only, always with a domain.
--   lib/home/get-weekly-completion.ts, app/(app)/calendar/actions.ts,
--   app/(app)/actions.ts do not read tasks.domain at all.
--
-- No `begin;`/`commit;` — the runner owns the transaction.

alter table public.tasks
  alter column domain drop not null;

comment on column public.tasks.domain is
  'NULL means "dumped, not categorised" -- a real state, not missing data, and the same shape as mit_rank''s NULL. The CHECK still restricts non-null values to school/co_op. Readers that mean class work must filter domain explicitly; a null row is never class work.';

do $$
declare
  v_nullable text;
  v_check text;
begin
  select is_nullable into v_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'tasks' and column_name = 'domain';
  if v_nullable <> 'YES' then
    raise exception 'migration 119: tasks.domain is still NOT NULL (is_nullable=%)', v_nullable;
  end if;

  -- Assert the CHECK SURVIVED. Dropping NOT NULL and losing the CHECK would
  -- leave the column accepting any string, and every existence-style check
  -- would still report success -- the failure shape this project has now been
  -- bitten by repeatedly.
  select pg_get_constraintdef(oid) into v_check from pg_constraint where conname = 'tasks_domain_check';
  if v_check is null then
    raise exception 'migration 119: tasks_domain_check is GONE -- the column would accept any string';
  end if;
  if v_check not like '%school%' or v_check not like '%co_op%' then
    raise exception 'migration 119: tasks_domain_check no longer admits school/co_op: %', v_check;
  end if;

  raise notice 'migration 119 verified: tasks.domain nullable, CHECK retained as %', v_check;
end $$;
