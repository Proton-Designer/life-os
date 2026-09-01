-- ULM content tables, batch 1: `cards`, the last table this batch needs to
-- unblock the seeded sample deck (D-018: books -> lessons -> cards ->
-- card_states, with card_states itself left for a later batch). Parent-
-- derived (reuses `set_user_id_from_book()`). `book_id` is trusted as
-- directly supplied on insert (by the card-generation stage of the
-- pipeline, which already knows which book a lesson belongs to) — same as
-- ULM's original schema, no additional book_id-from-lesson_id trigger; only
-- user_id is force-derived, from book_id, same mechanism as every other
-- table in this batch.

create table public.cards (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.lessons(id) on delete cascade,
  book_id      uuid not null references public.books(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  prompt_type  public.prompt_type not null,
  prompt       text not null,
  answer       text not null,
  sort_order   int not null default 0
);

create trigger cards_set_user_id
  before insert or update of book_id on public.cards
  for each row execute function public.set_user_id_from_book();

create index cards_lesson_id on public.cards (lesson_id);
create index cards_book_sort_order on public.cards (book_id, sort_order);

alter table public.cards enable row level security;

create policy cards_own_row on public.cards
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
