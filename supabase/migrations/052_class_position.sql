-- Engineer A, afternoon batch 2 (2026-08-26), item A1.
--
-- The School screen's class-card order is a personal preference (Prob &
-- Stats, DSA, Lin Alg, Ameri Studies, Phys, Phys Lab) that is neither
-- alphabetical nor `code`-sortable. Same reasoning as 048's short_name
-- seeding: this is a data statement about one account, not a schema rule,
-- so no CASE-over-course-codes lives in schema history — position is a
-- plain nullable column, backfilled here via a values-list match on
-- `code` (guarded to run once), and any class that doesn't match stays
-- null and sorts last by `code` instead of vanishing or erroring. A class
-- added later (or before this backfill runs for some other account) has
-- position null and simply falls to the back of the list, same graceful-
-- degradation pattern as short_name.
alter table public.classes add column position int null;

do $$
begin
  if not exists (select 1 from public.classes where position is not null) then
    update public.classes c
    set position = v.position
    from (values
      ('CS-3341-HON', 1),
      ('CS-3345-HON', 2),
      ('MATH 2418', 3),
      ('AMS-2341-HN1', 4),
      ('PHYS-2326-002', 5),
      ('PHYS-2126-105', 6)
    ) as v(code, position)
    where c.code = v.code;
  end if;
end $$;
