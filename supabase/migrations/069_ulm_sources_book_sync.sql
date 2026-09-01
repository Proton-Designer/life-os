-- ULM `sources` sync obligation. A book with no matching `sources` row is
-- invisible to the queue — no error, nothing surfaces, the content simply
-- never appears. Structurally the same "verdict derived from silence" shape
-- as `lessons.embedding` (a column nothing ever wrote) and the inert
-- progressive-availability UI: both looked perfectly healthy from every
-- angle except the one nobody checked. Contained structurally here, not by
-- convention — an AFTER INSERT trigger makes a book without a source
-- impossible rather than merely discouraged, in the same transaction as the
-- book insert itself.

create function public.create_book_source()
returns trigger
language plpgsql
as $$
begin
  insert into public.sources (user_id, kind, book_id) values (new.user_id, 'book', new.id);
  return new;
end;
$$;

create trigger books_create_source
  after insert on public.books
  for each row execute function public.create_book_source();

-- Backfill: no `books` rows exist in the scratch DB this was verified
-- against, but this has to be correct against live, where rows already
-- exist and predate this trigger. `where not exists` makes it safe to
-- re-run — a book that already somehow has a source (shouldn't happen post-
-- trigger, but this is a backfill, not a steady-state assumption) is left
-- alone rather than given a second one, which the unique partial index on
-- sources.book_id would reject anyway.
insert into public.sources (user_id, kind, book_id)
select b.user_id, 'book', b.id
from public.books b
where not exists (select 1 from public.sources s where s.book_id = b.id);
