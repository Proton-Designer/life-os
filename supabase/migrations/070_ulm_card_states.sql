-- ULM: `card_states`, the FSRS scheduling state per (card, user) — landed in
-- full per the Opus Lead's explicit ruling not to scope this one down (every
-- column is load-bearing for the queue or for FSRS itself; unlike
-- `user_stats`, nothing here is deferrable to a later RPC batch).
--
-- One column beyond the Lead's enumerated list: `book_id`. Not an addition —
-- it's required by `card_states_derive_and_check()` below (ported from
-- ULM's `20260815061000_l2_card_states_worker_insert.sql`, which sets
-- `new.book_id := parent_book`), the same denormalised-from-the-card
-- pattern as every other table in this batch, kept so RLS/queries never
-- need a join through `cards` to scope by book.
--
-- `fsrs_state` created here, not in the batch-1 prereqs file — unlike
-- book_status/ingest_stage/etc., which several tables share, this enum is
-- specific to card_states alone.

create type public.fsrs_state as enum ('new', 'learning', 'review', 'relearning');

create table public.card_states (
  card_id         uuid not null references public.cards(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  book_id         uuid not null references public.books(id) on delete cascade,
  stability       real,
  difficulty      real,
  due_at          timestamptz,
  reps            int not null default 0,
  lapses          int not null default 0,
  state           public.fsrs_state not null default 'new',
  last_review_at  timestamptz,
  last_rating     smallint check (last_rating between 1 and 4),
  primary key (card_id, user_id)
);

-- Consolidated trigger, ported verbatim in shape from
-- 20260815061000_l2_card_states_worker_insert.sql (the final, fixed version
-- — an earlier ULM revision had two separate triggers, one of which
-- unconditionally required auth.uid() and so had no legitimate path for the
-- ingestion worker, which writes as service_role with no JWT, to ever
-- populate this table). Branches on whether a caller session exists:
--   - authenticated caller: user_id is always the caller, never trusted
--     from input, and the referenced card must actually belong to them —
--     the adversarial smuggled-user_id case from the content-tables batch
--     applies here identically (it's overwritten, not merely rejected).
--   - no caller session (service_role): user_id must be supplied explicitly
--     AND must match the card's real owner — the worker gets a path in
--     without weakening the invariant that a card_states row can never
--     attach to a user who doesn't own the underlying card.
create or replace function public.card_states_derive_and_check()
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
    raise exception 'card_states: card % not found', new.card_id;
  end if;

  if auth.uid() is not null then
    if parent_owner <> auth.uid() then
      raise exception 'card_states: card % does not belong to the caller', new.card_id;
    end if;
    new.user_id := auth.uid();
  else
    if new.user_id is null or new.user_id <> parent_owner then
      raise exception
        'card_states: user_id must match the card''s owner (%) when set without a caller session',
        parent_owner;
    end if;
  end if;

  new.book_id := parent_book;
  return new;
end;
$$;

create trigger card_states_derive_and_check
  before insert or update of card_id on public.card_states
  for each row execute function public.card_states_derive_and_check();

-- Drives the due-queue read in get_session_queue (state <> 'new' and
-- due_at <= now()) — a partial index scoped to exactly that predicate.
create index card_states_due_queue
  on public.card_states (user_id, due_at)
  where state <> 'new';

alter table public.card_states enable row level security;

create policy card_states_own_row on public.card_states
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
