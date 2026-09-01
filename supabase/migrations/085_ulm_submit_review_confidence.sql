-- ULM: wire `reviews.confidence` (landed with the table in 072) into
-- `submit_review` (078, extended by 080/081). The column has existed,
-- unwritten, since 072 -- verified: zero matches for `confidence` in 078.
-- Same shape as `lessons.embedding`: a live column nothing fills, authored
-- by us this time (072 dispatched the column, 078 dispatched separately,
-- never connected). Closing it now for a waiting consumer -- LifeOS
-- Engineer 1 is building the confidence-tap UI and asked before collecting
-- taps into a void.
--
-- Nullable and DEFAULTED, not required: ULM's free-recall cards may not
-- collect a confidence tap, and a review without one is legitimate, not an
-- error or a placeholder. A required-by-accident parameter here would
-- break every existing ULM free-recall caller.
--
-- Body below is copied VERBATIM from the live function
-- (`pg_get_functiondef('public.submit_review'::regproc)`, checked against
-- the scratch DB before writing this, not reconstructed from 078's
-- original text alone -- 080 added the `user_stats` ensure-row insert and
-- 081 added the `book_is_deleted` soft-delete guard, both additive over
-- 078). Nothing else in this function changes -- the reps invariant, the
-- stability > 0 / due_at-in-future / illegal-transition checks, the
-- soft-delete guard all stay exactly as verified. Two changes only: the
-- new `p_confidence` parameter, and `confidence` added to the INSERT's
-- column and value lists.
--
-- `CREATE OR REPLACE FUNCTION` cannot do this in place: appending a new
-- parameter (even a defaulted one) to an existing function does not
-- replace it -- Postgres treats the new argument list as a DIFFERENT
-- signature and creates a SECOND, overloaded function. Confirmed live in a
-- rolled-back probe against the scratch DB before writing this migration:
-- two functions ended up in pg_proc, and calling with the original
-- 8-argument shape then raised "is not unique" -- an ambiguous overload,
-- not a clean replacement. `submit_review`'s original 8-parameter version
-- is therefore explicitly DROPPED first, then recreated with the 9th
-- parameter -- there is exactly one `submit_review` after this migration,
-- never two.
--
-- DROP and CREATE, wrapped in an explicit transaction: this is the shared
-- scratch DB, and unlike a single in-place `CREATE OR REPLACE`, DROP+CREATE
-- is two DDL statements with a real gap between them. DDL is transactional
-- in Postgres, so `begin`/`commit` here means any concurrent caller sees
-- either the old 8-argument function or the new 9-argument one, never a
-- moment where `submit_review` doesn't exist at all.
begin;

drop function public.submit_review(uuid, uuid, smallint, int, text, text, smallint, jsonb);

create function public.submit_review(
  p_card_id uuid,
  p_session_id uuid,
  p_rating smallint,
  p_elapsed_ms int,
  p_answered_text text,
  p_ai_feedback text,
  p_ai_suggested_rating smallint,
  p_next_state jsonb,
  p_confidence public.confidence_level default null
)
returns public.reviews
language plpgsql
security invoker
as $$
declare
  caller uuid := auth.uid();
  prev public.card_states;
  new_reps int;
  new_stability real;
  new_difficulty real;
  new_due_at timestamptz;
  new_state public.fsrs_state;
  inserted public.reviews;
  book_deleted boolean;
begin
  if caller is null then
    raise exception 'submit_review: no authenticated user';
  end if;
  if p_rating not between 1 and 4 then
    raise exception 'submit_review: rating must be 1..4';
  end if;

  insert into public.user_stats (user_id) values (caller) on conflict (user_id) do nothing;

  select * into prev from public.card_states
    where card_id = p_card_id and user_id = caller
    for update;

  if not found then
    raise exception 'submit_review: no card_states row for card % / user %', p_card_id, caller;
  end if;

  book_deleted := public.book_is_deleted(prev.book_id);
  if book_deleted then
    raise exception 'submit_review: book for card % has been deleted', p_card_id;
  end if;

  new_reps       := coalesce((p_next_state->>'reps')::int, prev.reps + 1);
  new_stability  := (p_next_state->>'stability')::real;
  new_difficulty := (p_next_state->>'difficulty')::real;
  new_due_at     := (p_next_state->>'due_at')::timestamptz;
  new_state      := (p_next_state->>'state')::public.fsrs_state;

  if new_reps <> prev.reps + 1 then
    raise exception 'submit_review: reps must increase by exactly 1 (was %, proposed %)',
      prev.reps, new_reps;
  end if;
  if new_stability is null or new_stability <= 0 then
    raise exception 'submit_review: stability must be > 0 (proposed %)', new_stability;
  end if;
  if new_due_at is null or new_due_at <= now() then
    raise exception 'submit_review: due_at must be in the future (proposed %)', new_due_at;
  end if;
  if new_state is null then
    raise exception 'submit_review: state is required';
  end if;
  if prev.state = 'new' and new_state not in ('learning', 'review') then
    raise exception 'submit_review: illegal transition new -> %', new_state;
  end if;

  insert into public.reviews (
    card_id, session_id, rating, confidence, elapsed_ms, answered_text, ai_feedback,
    ai_suggested_rating, state_before, stability_before, difficulty_before,
    stability_after, difficulty_after, scheduled_days
  ) values (
    p_card_id, p_session_id, p_rating, p_confidence, p_elapsed_ms, p_answered_text, p_ai_feedback,
    p_ai_suggested_rating, prev.state, prev.stability, prev.difficulty,
    new_stability, new_difficulty,
    extract(epoch from (new_due_at - now())) / 86400.0
  ) returning * into inserted;

  update public.card_states set
    stability = new_stability,
    difficulty = new_difficulty,
    due_at = new_due_at,
    reps = new_reps,
    lapses = case when p_rating = 1 then prev.lapses + 1 else prev.lapses end,
    state = new_state,
    last_review_at = now(),
    last_rating = p_rating
  where card_id = p_card_id and user_id = caller;

  if p_session_id is not null then
    update public.work_sessions set cards_reviewed = coalesce(cards_reviewed, 0) + 1
      where id = p_session_id and user_id = caller;
  end if;

  update public.user_stats set total_reviews = total_reviews + 1
    where user_id = caller;

  return inserted;
end;
$$;

commit;
