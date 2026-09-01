-- ULM content tables, batch 1: `book_sections`. Parent-derived, not
-- caller-owned: user_id is forced from the parent `books` row by trigger,
-- never from client input and never from auth.uid() — the ingestion worker
-- writes this table with the service_role key, which has no auth.uid() at
-- all (no user JWT), so auth.uid()-based derivation isn't available here.
-- This is the fixed shape, not the original one: an earlier version of this
-- trigger design forced `user_id = auth.uid()` even on parent-derived
-- tables, which made the RLS WITH CHECK tautological (it would always
-- match whatever the trigger just set) — the actual check has to be against
-- the PARENT row's real owner, looked up fresh, which is what
-- `set_user_id_from_book` does below.

create table public.book_sections (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.books(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text,
  sort_order  int not null default 0,
  page_start  int,
  page_end    int,
  level       int not null default 1
);

create function public.set_user_id_from_book()
returns trigger
language plpgsql
as $$
declare
  owner uuid;
begin
  select user_id into owner from public.books where id = new.book_id;
  if owner is null then
    raise exception 'set_user_id_from_book: book % not found', new.book_id;
  end if;
  new.user_id := owner;
  return new;
end;
$$;

create trigger book_sections_set_user_id
  before insert or update of book_id on public.book_sections
  for each row execute function public.set_user_id_from_book();

create index book_sections_book_id on public.book_sections (book_id);

alter table public.book_sections enable row level security;

create policy book_sections_own_row on public.book_sections
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
