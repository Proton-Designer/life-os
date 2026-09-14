-- 161: #24/#26 -- `submit_question_review`, a sibling of `submit_review`
-- for question-backed card_states rows, not a rewrite of `submit_review`
-- itself. Closes the write-side half of "reuse the existing scheduler for
-- questions": 160 makes the queue surface a question-backed entry; without
-- this, grading it has nowhere to go -- `submit_review(p_card_id uuid,
-- ...)` requires a real `cards` row (`select * from card_states where
-- card_id = p_card_id`) and raises for any question-backed card_states row,
-- which `offline-queue.ts`'s `isPermanentFailure` classifies as permanent
-- -- a question review would be silently and permanently dropped, never
-- retried, never surfaced. See lib/self-mastery/session/offline-queue.ts's
-- own change in this batch for the client side of this fix -- both land
-- together, per the architect's explicit instruction.
--
-- WHY A SIBLING, NOT AN OVERLOADED/EXTENDED `submit_review`: `submit_review`
-- is the single most heavily-relied-on write path in this platform today
-- (every real review, all 49 of them, and every future one) --
-- restructuring its control flow to branch on item kind is exactly the
-- highest-risk way to ship this. A sibling with an identical shape and
-- (where the underlying check is the same) BYTE-IDENTICAL raise message
-- substrings leaves `submit_review` untouched -- reviewable, revertable,
-- and provably a no-op for the card path, independent of this file.
--
-- LOAD-BEARING TEXT, MATCHED IN `lib/self-mastery/session/offline-queue.ts`.
-- Every substring `submit_review` raises that `isPermanentFailure` matches
-- is reproduced HERE VERBATIM, in full, deliberately, so the SAME classifier
-- function serves both RPCs without needing a single new string for the
-- shared cases: 'no authenticated user' / 'rating must be' / 'no card_states
-- row' / 'reps must increase by exactly' / 'stability must be > 0' /
-- 'due_at must be in the future' / 'state is required' / 'illegal
-- transition'. ONE new substring is introduced -- 'has been retired', the
-- question-path twin of submit_review's 'has been deleted' (081) -- added
-- to `isPermanentFailure`'s list in the SAME change, per the mirror-image
-- warning `088` put on every raise in `submit_review` itself. Reword ANY
-- message below only together with that file.
--
-- WHY THERE IS NO `question_is_deleted` GUARD PARALLELING `book_is_deleted`:
-- `classes` has no soft-delete column (checked: no `deleted_at` anywhere on
-- `public.classes`) -- a class is hard-deleted and its `questions` cascade
-- (`questions_class_id_fkey ... on delete cascade`), which cascades again to
-- `card_states.question_id` and `reviews.question_id` (both `on delete
-- cascade`, 111). A hard-deleted class's question therefore has NO
-- `card_states` row left to find by the time this function's own `select
-- ... for update` runs -- it fails the EXISTING 'no card_states row' guard,
-- for the ordinary, already-load-bearing reason, not a new one. The one
-- state a hard-delete cannot express is `questions.active = false`
-- (RETIRED, not deleted -- 111's own words: "Retired rather than deleted
-- ... there is no delete-a-question affordance") -- that row still exists,
-- still has a `card_states` row, and grading it would silently record a
-- review against content the user has explicitly said to stop being asked.
-- THAT is the guard this file adds, and it has no card-path analogue: a
-- card has no equivalent "retired but the row and its card_states survive"
-- state (126's suspension mechanism REMOVES a card from the queue but never
-- blocks a direct grade of it if one somehow arrives -- consistency with
-- that existing posture would argue against this guard too; it is added
-- anyway because `questions.active`'s own doc comment ("Retired questions
-- stay for review history") reads as a stronger, more deliberate promise
-- than suspension's "stop asking, but don't refuse a stray grade" than the
-- card path ever made -- flagged here as a real judgment call, not an
-- obvious symmetry).
--
-- CONFIDENCE/CORRECT (#26 -- "no standalone scope, fold it in"): this
-- signature accepts `p_confidence confidence_level` (085's type, identical
-- parameter) and `p_correct boolean` (111's `reviews.correct` -- "the raw
-- outcome for the question path, distinct from the derived rating"). No
-- (confidence, correct) -> rating derivation lives here: `p_rating` is
-- still supplied by the caller, exactly as `submit_review` requires it
-- today -- that derivation is a CollegeOS UI concern (111's own comment:
-- "the shared (confidence, correct) -> rating function"), out of this
-- repo's scheduler-boundary ownership, not decided here.
--
-- Transaction control is the RUNNER's -- no begin/commit in this file.

CREATE OR REPLACE FUNCTION public.submit_question_review(
  p_question_id uuid,
  p_session_id uuid,
  p_rating smallint,
  p_elapsed_ms integer,
  p_answered_text text,
  p_ai_feedback text,
  p_ai_suggested_rating smallint,
  p_next_state jsonb,
  p_confidence confidence_level DEFAULT NULL::confidence_level,
  p_correct boolean DEFAULT NULL::boolean
)
RETURNS reviews
LANGUAGE plpgsql
AS $function$
declare
  caller uuid := auth.uid();
  prev public.card_states;
  new_reps int;
  new_stability real;
  new_difficulty real;
  new_due_at timestamptz;
  new_state public.fsrs_state;
  new_learning_steps int;
  new_request_retention real;
  inserted public.reviews;
  q_active boolean;
begin
  if caller is null then
    -- LOAD-BEARING TEXT, shared with submit_review: matched by
    -- offline-queue.ts's isPermanentFailure ("no authenticated user").
    raise exception 'submit_question_review: no authenticated user';
  end if;
  if p_rating not between 1 and 4 then
    -- LOAD-BEARING TEXT, shared with submit_review: matched by
    -- offline-queue.ts's isPermanentFailure ("rating must be").
    raise exception 'submit_question_review: rating must be 1..4';
  end if;

  insert into public.user_stats (user_id) values (caller) on conflict (user_id) do nothing;

  select * into prev from public.card_states
    where question_id = p_question_id and user_id = caller
    for update;

  if not found then
    -- LOAD-BEARING TEXT, shared with submit_review: matched by
    -- offline-queue.ts's isPermanentFailure ("no card_states row").
    raise exception 'submit_question_review: no card_states row for question % / user %', p_question_id, caller;
  end if;

  select active into q_active from public.questions where id = p_question_id;
  if q_active is false then
    -- LOAD-BEARING TEXT, NEW: matched by offline-queue.ts's
    -- isPermanentFailure ("has been retired") -- see this file's header for
    -- why this has no submit_review analogue.
    raise exception 'submit_question_review: question % has been retired', p_question_id;
  end if;

  new_reps       := coalesce((p_next_state->>'reps')::int, prev.reps + 1);
  new_stability  := (p_next_state->>'stability')::real;
  new_difficulty := (p_next_state->>'difficulty')::real;
  new_due_at     := (p_next_state->>'due_at')::timestamptz;
  new_state      := (p_next_state->>'state')::public.fsrs_state;

  if p_next_state ? 'learning_steps' then
    new_learning_steps := (p_next_state->>'learning_steps')::int;
  else
    raise exception 'submit_question_review: learning_steps is required in p_next_state';
  end if;

  insert into public.user_settings (user_id) values (caller)
    on conflict (user_id) do nothing;

  select desired_retention into new_request_retention
    from public.user_settings where user_id = caller;
  if new_request_retention is null then
    raise exception 'submit_question_review: no user_settings row for caller % -- cannot record request_retention', caller;
  end if;

  if new_reps <> prev.reps + 1 then
    -- LOAD-BEARING TEXT, shared with submit_review: matched by
    -- offline-queue.ts's isPermanentFailure ("must increase by exactly").
    raise exception 'submit_question_review: reps must increase by exactly 1 (was %, proposed %)',
      prev.reps, new_reps;
  end if;
  if new_stability is null or new_stability <= 0 then
    -- LOAD-BEARING TEXT, shared with submit_review: matched by
    -- offline-queue.ts's isPermanentFailure ("must be > 0").
    raise exception 'submit_question_review: stability must be > 0 (proposed %)', new_stability;
  end if;
  if new_due_at is null or new_due_at <= now() then
    -- LOAD-BEARING TEXT, shared with submit_review: matched by
    -- offline-queue.ts's isPermanentFailure ("must be in the future").
    raise exception 'submit_question_review: due_at must be in the future (proposed %)', new_due_at;
  end if;
  if new_state is null then
    -- LOAD-BEARING TEXT, shared with submit_review: matched by
    -- offline-queue.ts's isPermanentFailure ("state is required").
    raise exception 'submit_question_review: state is required';
  end if;
  if prev.state = 'new' and new_state not in ('learning', 'review') then
    -- LOAD-BEARING TEXT, shared with submit_review: matched by
    -- offline-queue.ts's isPermanentFailure ("illegal transition").
    raise exception 'submit_question_review: illegal transition new -> %', new_state;
  end if;

  insert into public.reviews (
    question_id, session_id, rating, confidence, correct, elapsed_ms, answered_text, ai_feedback,
    ai_suggested_rating, state_before, stability_before, difficulty_before,
    stability_after, difficulty_after, scheduled_days,
    state_after, learning_steps_after, request_retention
  ) values (
    p_question_id, p_session_id, p_rating, p_confidence, p_correct, p_elapsed_ms, p_answered_text, p_ai_feedback,
    p_ai_suggested_rating, prev.state, prev.stability, prev.difficulty,
    new_stability, new_difficulty,
    extract(epoch from (new_due_at - now())) / 86400.0,
    new_state, new_learning_steps, new_request_retention
  ) returning * into inserted;

  update public.card_states set
    stability = new_stability,
    difficulty = new_difficulty,
    due_at = new_due_at,
    reps = new_reps,
    lapses = case when p_rating = 1 and prev.state = 'review' then prev.lapses + 1 else prev.lapses end,
    state = new_state,
    learning_steps = new_learning_steps,
    last_review_at = now(),
    last_rating = p_rating
  where question_id = p_question_id and user_id = caller;

  if p_session_id is not null then
    update public.work_sessions set cards_reviewed = coalesce(cards_reviewed, 0) + 1
      where id = p_session_id and user_id = caller;
  end if;

  update public.user_stats set total_reviews = total_reviews + 1
    where user_id = caller;

  return inserted;
end;
$function$
;
