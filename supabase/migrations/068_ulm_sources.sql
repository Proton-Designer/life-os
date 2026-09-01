-- ULM/CollegeOS shared table: `sources`. ULM owns this table and the queue
-- that reads it; CollegeOS owns how a course becomes one (their follow-up
-- after 095-096 adds `source_id` to `questions`). Shape agreed between the
-- two Opus leads — see convergence-ops/briefs/ULM-landing-plan.md, "sources
-- — agreed shape."
--
-- `num_nonnulls(book_id, class_id) = 1` is the CollegeOS lead's constraint,
-- not a comment-and-hope version of the same idea: a source pointing at
-- BOTH or NEITHER would give the queue undefined behaviour (which branch
-- wins?) rather than wrong-but-predictable, so it's unrepresentable at the
-- database level instead of merely discouraged.
--
-- `classes` already exists in the baseline (000_baseline.sql), so both FKs
-- resolve today — this table does not need to wait on CollegeOS's 095-096.

create table public.sources (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users(id) on delete cascade,
  kind     text not null check (kind in ('book', 'course')),
  book_id  uuid references public.books(id) on delete cascade,
  class_id uuid references public.classes(id) on delete cascade,
  check (num_nonnulls(book_id, class_id) = 1)
);

create index sources_user_id on public.sources (user_id);
create unique index sources_book_id_unique on public.sources (book_id) where book_id is not null;
create unique index sources_class_id_unique on public.sources (class_id) where class_id is not null;

alter table public.sources enable row level security;

create policy sources_own_row on public.sources
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
