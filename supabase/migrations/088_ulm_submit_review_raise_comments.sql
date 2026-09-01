-- ULM: annotate every `raise exception` in `submit_review` as load-bearing text,
-- not just behavior. Comment-only — the function's logic, signature, and every
-- validation rule are UNCHANGED from `085`. Body verified against the live
-- definition (`pg_get_functiondef('public.submit_review'::regproc)` on the
-- scratch DB, 2026-09-01) before writing this, per the rule recorded in
-- ULM's `docs/specs/convergence-coverage.md` §6 — never reconstructed from an
-- earlier migration file.
--
-- WHY THIS MIGRATION EXISTS: `lib/self-mastery/session/offline-queue.ts`'s
-- `isPermanentFailure` classifies a `submit_review` failure as permanent
-- (never retry) or transient (retry) by matching a SUBSTRING of this
-- function's exception MESSAGE TEXT. That coupling is invisible to `tsc`,
-- invisible to `psql`, invisible to code review unless the reviewer happens
-- to have both files open — a string, spanning two languages and two
-- repositories, connected by nothing a compiler can see. `081` proved this is
-- not hypothetical: it added the `book_is_deleted` message below, which does
-- not exist in ULM's original schema, and a naive port of ULM's classifier
-- would have let it fall through to the transient default — a review against
-- a permanently soft-deleted book's card, retried every replay, forever.
--
-- The direction that actually breaks this is server -> client: someone
-- tidying a `raise exception` string in a future migration is the person who
-- silently breaks retry classification, and they will very likely never open
-- `offline-queue.ts`. This migration puts the warning where THAT person is
-- standing, not only in the TypeScript file where the coupling is easy to
-- find if you already know to look.
create or replace function public.submit_review(
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
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("no authenticated user"). Reword only together with that file.
    raise exception 'submit_review: no authenticated user';
  end if;
  if p_rating not between 1 and 4 then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("rating must be"). Reword only together with that file.
    raise exception 'submit_review: rating must be 1..4';
  end if;

  insert into public.user_stats (user_id) values (caller) on conflict (user_id) do nothing;

  select * into prev from public.card_states
    where card_id = p_card_id and user_id = caller
    for update;

  if not found then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("no card_states row"). Reword only together with that file.
    raise exception 'submit_review: no card_states row for card % / user %', p_card_id, caller;
  end if;

  book_deleted := public.book_is_deleted(prev.book_id);
  if book_deleted then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("has been deleted") — added by 081, NOT present in ULM's original
    -- schema, and the specific message a naive port of that file's
    -- classifier missed. Reword only together with that file.
    raise exception 'submit_review: book for card % has been deleted', p_card_id;
  end if;

  new_reps       := coalesce((p_next_state->>'reps')::int, prev.reps + 1);
  new_stability  := (p_next_state->>'stability')::real;
  new_difficulty := (p_next_state->>'difficulty')::real;
  new_due_at     := (p_next_state->>'due_at')::timestamptz;
  new_state      := (p_next_state->>'state')::public.fsrs_state;

  if new_reps <> prev.reps + 1 then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("must increase by exactly"). Reword only together with that file.
    raise exception 'submit_review: reps must increase by exactly 1 (was %, proposed %)',
      prev.reps, new_reps;
  end if;
  if new_stability is null or new_stability <= 0 then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("must be > 0"). Reword only together with that file.
    raise exception 'submit_review: stability must be > 0 (proposed %)', new_stability;
  end if;
  if new_due_at is null or new_due_at <= now() then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("must be in the future"). Reword only together with that file.
    raise exception 'submit_review: due_at must be in the future (proposed %)', new_due_at;
  end if;
  if new_state is null then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("state is required"). Reword only together with that file.
    raise exception 'submit_review: state is required';
  end if;
  if prev.state = 'new' and new_state not in ('learning', 'review') then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("illegal transition"). Reword only together with that file.
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
