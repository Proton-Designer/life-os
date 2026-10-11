-- 265: Where inside the current page the reader is.
--
-- The khatm plan's bookmark (quran_plans.current_page) is the NEXT WHOLE PAGE to read. A reader who stops partway down a
-- page ("I'm on Al-Baqara 2:150") is resting at an ayah, not at a page boundary, so the plan also remembers that ayah:
-- `current_ayah` = the GLOBAL ayah number (1..6236, Al-Fatiha 1:1 = 1 ... An-Nas 114:6 = 6236, lib/quran/ayah-map.ts) the
-- reader is on. NULL = at the top of current_page (every row that exists today). The app keeps current_ayah on current_page
-- (it clears it whenever the bookmark moves to another page); the DB only bounds it.
--
-- One additive nullable column; no backfill, no index, no policy change.
-- No begin;/commit; -- the runner owns the transaction.

alter table public.quran_plans
  add column current_ayah smallint
    constraint quran_plans_current_ayah_range check (current_ayah between 1 and 6236);

comment on column public.quran_plans.current_ayah is
  'QURAN-03: global ayah number (1..6236) the reader is on inside current_page. NULL = the top of current_page.';

do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'quran_plans' and column_name = 'current_ayah'
     and data_type = 'smallint' and is_nullable = 'YES';
  if v_n <> 1 then
    raise exception 'migration 265: expected quran_plans.current_ayah smallint nullable, found % matching columns', v_n;
  end if;

  select count(*) into v_n from pg_constraint
   where conrelid = 'public.quran_plans'::regclass and conname = 'quran_plans_current_ayah_range';
  if v_n <> 1 then
    raise exception 'migration 265: missing CHECK quran_plans_current_ayah_range';
  end if;

  raise notice 'migration 265 verified: quran_plans.current_ayah smallint nullable, CHECK 1..6236';
end $$;
