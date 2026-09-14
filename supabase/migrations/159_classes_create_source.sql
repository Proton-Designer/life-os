-- 159: close the course-side `sources` gap `086`'s header flagged and left
-- open -- "classes never got the equivalent trigger... so the class_id
-- side had NO mechanism at all, not even an incidental one." Prerequisite
-- for #25 (cross-source interleaving): `get_session_queue`'s book arm has
-- been safe against a book with no `sources` row since `069`'s
-- `books_create_source` trigger; the course arm has no such guarantee
-- today, and adding it is what makes it safe to write at all.
--
-- VERIFIED ON PRODUCTION, NOT ASSUMED (2026-09-14): every one of the 17
-- real classes has zero matching `sources` rows --
--   select count(*) from public.classes c
--     where not exists (select 1 from public.sources s where s.class_id = c.id);
--   -- 17
-- and `public.sources` has 20 rows total, all `kind = 'book'`. The course
-- arm's silent-vanishing risk `086` warned about ("without it, every
-- question in a class with no source row vanishes silently") is not a
-- hypothetical for this codebase -- it is the CURRENT state of every real
-- class. `public.questions` has zero rows today, so the blast radius of
-- this gap is zero right now, but it would not stay zero the moment
-- CollegeOS's own question-creation flow starts writing rows against a
-- class that still has no source.
--
-- THE FIX mirrors `069`'s `books_create_source` exactly -- same shape, same
-- reasoning, same AFTER INSERT-in-the-same-transaction discipline, applied
-- to the table `086` explicitly said never got it. Not a coincidence: `086`
-- already named this as the missing piece ("that's CollegeOS's follow-up
-- once questions gets source_id") -- but `111`'s actual schema (the section
-- that DID land) put `class_id` directly on `questions`, not a `source_id`
-- indirection, so there is no reason left to wait for a `source_id` column
-- that was never built. The join this batch's `get_session_queue` needs is
-- `sources.class_id = questions.class_id`, available today.
--
-- BACKFILL: all 17 existing classes get their `sources` row now, same
-- `where not exists` idempotent form `069` used, safe to re-run.
--
-- Transaction control is the RUNNER's -- no begin/commit in this file.

create or replace function public.create_class_source()
returns trigger
language plpgsql
as $$
begin
  insert into public.sources (user_id, kind, class_id) values (new.user_id, 'course', new.id);
  return new;
end;
$$;

comment on function public.create_class_source() is
  '159: course-side twin of 069''s create_book_source(). Makes a class without a matching sources row impossible, in the same transaction as the class insert -- the same structural guarantee the book side has had since 069, which 086''s header documented the course side as missing entirely.';

drop trigger if exists classes_create_source on public.classes;
create trigger classes_create_source
  after insert on public.classes
  for each row execute function public.create_class_source();

-- Backfill, idempotent (`where not exists`) -- safe against a class that
-- somehow already has a source (shouldn't happen pre-trigger, but this is a
-- backfill, not a steady-state assumption; the partial unique index
-- `sources_class_id_unique` (068) would reject a second one anyway).
insert into public.sources (user_id, kind, class_id)
select c.user_id, 'course', c.id
from public.classes c
where not exists (select 1 from public.sources s where s.class_id = c.id);

-- Shape assert: every class has exactly one course-kind source afterward.
do $$
declare missing int;
begin
  select count(*) into missing
    from public.classes c
    where not exists (select 1 from public.sources s where s.class_id = c.id and s.kind = 'course');
  if missing > 0 then
    raise exception '159 shape assert failed: % class(es) still have no course-kind sources row', missing;
  end if;
end $$;
