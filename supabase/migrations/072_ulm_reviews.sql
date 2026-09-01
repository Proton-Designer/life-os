-- ULM: `reviews`, the append-only review log — the table the brief calls
-- sacred ("Every review is appended to an immutable review log... This log
-- is sacred: it enables per-user FSRS parameter optimization later and
-- feeds the Analyst in future phases. Never overwrite it."). CollegeOS's
-- illusion-of-competence analytics also depend on it. Columns sourced from
-- ULM's `20260815040000_l1a_schema.sql`, kept in full — before/after
-- stability and difficulty are what make per-user FSRS parameter fitting
-- possible later, deliberately richer than the brief strictly requires.
--
-- One column beyond the Opus Lead's enumerated list: `book_id`, same
-- reasoning as `card_states` (070) — denormalised from the card via the
-- same `set_book_id_from_card`-shaped trigger below, so per-book review
-- queries never need a join through `cards`. Flagging it explicitly rather
-- than silently including it, same as last time.
--
-- Three changes for the merged platform:
-- 1. `session_id` references `public.work_sessions(id)`, not ULM's old
--    `sessions` (doesn't exist on this platform). The FK resolves today;
--    no review can actually carry a `learn`-kind session until the
--    work_sessions widening lands — expected, not worked around here.
-- 2. `confidence` — the settled cross-team calibration design, landing with
--    the table rather than after. Nullable: ULM's own session flow doesn't
--    collect it yet, CollegeOS's does. A native enum, not text+CHECK — the
--    Opus Lead's own recent incident (`WorkSessionKind`, `lib/business/
--    work-session-kind.ts`) is a `data.kind as WorkSessionKind` cast with
--    no runtime check, where a DB value outside the narrower TS union would
--    silently pass through uncaught. An enum is enforced by Postgres itself
--    at every write, not by whichever CHECK constraint someone remembered
--    to add — closes that exact class of drift rather than reproducing it.
--    Values match `packages/core/src/fsrs/calibration.ts`'s `Confidence`
--    type in the ULM repo verbatim (`sure` | `think_so` | `guessing`).
-- 3. `user_id` references `auth.users(id)`, not ULM's `public.profiles(id)`
--    — same reason as every other table in this batch.

create type public.confidence_level as enum ('sure', 'think_so', 'guessing');

create table public.reviews (
  id                   uuid primary key default gen_random_uuid(),
  card_id              uuid not null references public.cards(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  book_id              uuid not null references public.books(id) on delete cascade,
  session_id           uuid references public.work_sessions(id) on delete set null,
  rating               smallint not null check (rating between 1 and 4),
  confidence           public.confidence_level,
  elapsed_ms           int,
  answered_text        text,
  ai_feedback          text,
  ai_suggested_rating  smallint check (ai_suggested_rating between 1 and 4),
  state_before         public.fsrs_state,
  stability_before     real,
  difficulty_before    real,
  stability_after      real,
  difficulty_after     real,
  scheduled_days       real,
  reviewed_at          timestamptz not null default now()
);

-- Same parent-derivation shape as card_states (070): user_id/book_id come
-- from the referenced card's real owner, never from client input, and the
-- adversarial case (a smuggled foreign user_id) is overwritten rather than
-- merely rejected. No service_role branch needed here — unlike card_states,
-- nothing writes reviews without a caller session; the worker never grades
-- a review on a user's behalf.
create or replace function public.set_review_owner_from_card()
returns trigger
language plpgsql
as $$
declare
  parent_book uuid;
  parent_owner uuid;
begin
  select book_id, user_id into parent_book, parent_owner
    from public.cards where id = new.card_id;

  if parent_book is null then
    raise exception 'reviews: card % not found', new.card_id;
  end if;

  if auth.uid() is null then
    raise exception 'reviews: no caller session (reviews are never written on a user''s behalf)';
  end if;
  if parent_owner <> auth.uid() then
    raise exception 'reviews: card % does not belong to the caller', new.card_id;
  end if;

  new.user_id := auth.uid();
  new.book_id := parent_book;
  return new;
end;
$$;

create trigger reviews_set_owner
  before insert on public.reviews
  for each row execute function public.set_review_owner_from_card();

-- The whole point of this table. No role exemption — fires for service_role
-- too, which is what makes the log trustworthy as evidence rather than a
-- convention (ULM proved this under attack). The ONE sanctioned door is
-- `purge_user_data`, which disables these triggers inside its own
-- transaction for whole-account deletion — that RPC lands in a later batch
-- and is not built here. No other exemption exists or should exist; a new
-- one is a design conversation with the Opus Lead, not a migration.
create function public.reject_review_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'reviews is append-only (attempted %)', tg_op;
end;
$$;

create trigger reviews_no_update
  before update on public.reviews
  for each row execute function public.reject_review_mutation();

create trigger reviews_no_delete
  before delete on public.reviews
  for each row execute function public.reject_review_mutation();

create index reviews_card_id on public.reviews (card_id);
create index reviews_user_reviewed_at on public.reviews (user_id, reviewed_at);

alter table public.reviews enable row level security;

-- select + insert only, deliberately no update/delete policy at all — with
-- RLS enabled and no UPDATE/DELETE policy, those operations are denied
-- outright for any role subject to RLS, before the trigger even runs. The
-- trigger is defence in depth on top of that, not the primary defence.
create policy reviews_select on public.reviews for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy reviews_insert on public.reviews for insert
  to authenticated
  with check (user_id = (select auth.uid()));
