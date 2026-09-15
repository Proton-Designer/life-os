-- 178 -- book_ready_notification_log.book_id: single-column FK -> composite
-- tenancy FK (user_id, book_id) -> books(user_id, id).
--
-- 177 shipped `book_id references public.books(id)`, a single-column FK to a
-- user-scoped parent. That makes a row claiming user A with user B's book
-- representable -- the exact shape migrations 100/101/150 and
-- check-fk-tenancy.sh exist to forbid. The Phase-1 lead reviewed 177 and missed
-- it; check-fk-tenancy.sh (wired into preflight hours earlier) caught it on its
-- first run after the apply. Table has zero rows, so this is a pure constraint
-- swap. books_user_id_id_key already provides the (user_id, id) target.
-- ON DELETE CASCADE (not SET NULL) -- no composite SET NULL trap applies.
-- No begin;/commit; -- the runner owns the transaction.

alter table public.book_ready_notification_log
  drop constraint book_ready_notification_log_book_id_fkey;

alter table public.book_ready_notification_log
  add constraint book_ready_notification_log_book_same_user
  foreign key (user_id, book_id) references public.books (user_id, id) on delete cascade;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.book_ready_notification_log'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) ~ '^FOREIGN KEY \(book_id\) REFERENCES books\(id\)'
  ) then
    raise exception '178 shape assert: single-column book_id FK still present';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'book_ready_notification_log_book_same_user'
      and pg_get_constraintdef(oid) ~ 'FOREIGN KEY \(user_id, book_id\) REFERENCES books\(user_id, id\) ON DELETE CASCADE'
  ) then
    raise exception '178 shape assert: composite tenancy FK missing or wrong';
  end if;
  raise notice '178 verified: book_ready_notification_log uses composite (user_id, book_id) -> books(user_id, id)';
end $$;
