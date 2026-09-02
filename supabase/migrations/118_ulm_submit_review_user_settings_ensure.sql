-- 118: close the `user_settings` reader gap, and make the class unforgettable.
--
-- THE DEFECT. `111` added a hard `raise` to `submit_review` when the caller has
-- no `user_settings` row, on the stated belief that `080`'s
-- `ensure_user_stats_settings` guaranteed one by the time a card is gradable.
-- It does not. `080` put the ensure in `start_session` and reasoned that
-- everything downstream was covered by construction -- which covered every
-- WRITER and no READER. `submit_review` reads `user_settings.desired_retention`
-- directly. On production today a caller reaching `submit_review` without
-- first calling `start_session` gets a hard error. (Verified on production
-- 2026-09-02: `submit_review` contains no `insert into public.user_settings`.)
--
-- THE FIX. One line, the same one `start_session` has always had, placed before
-- the read that raises. Not a trigger on `auth.users`: `080` rejected that
-- approach for a documented reason (it runs inside Supabase's auth transaction,
-- so a bug breaks signup for every account), and that reasoning was
-- re-verified before this file rather than taken from its header.
--
-- THE GUARD, and why it is in the migration rather than a check-*.sh. The
-- ruling that produced this bug failed because it depended on a person
-- REMEMBERING to add the ensure at the next reader. A script has to be
-- remembered and run; a DO block runs whenever anyone applies. So the guard
-- lives here: it enumerates every function that READS `public.user_settings`
-- and raises if any of them does not also ENSURE the row.
--
-- ⚠️ THE GUARD'S LIMITATION, stated rather than implied: it is a TEXT MATCH
-- over `pg_get_functiondef`. A function that reads `user_settings` through a
-- view, through dynamic SQL, or under a different spelling is invisible to it.
-- It catches the shape that actually bit us; it does not prove the absence of
-- every possible reader. `prokind='f'` excludes aggregates, whose OIDs
-- `pg_get_functiondef` refuses outright.
--
-- Transaction control is the RUNNER's (R33) -- no begin/commit in this file.
-- Population at authoring time, on a container at post-117 production shape:
--   start_session   reads=false  ensures=true
--   submit_review   reads=true   ensures=false   <- the offender this closes

CREATE OR REPLACE FUNCTION public.submit_review(p_card_id uuid, p_session_id uuid, p_rating smallint, p_elapsed_ms integer, p_answered_text text, p_ai_feedback text, p_ai_suggested_rating smallint, p_next_state jsonb, p_confidence confidence_level DEFAULT NULL::confidence_level)
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
    -- ("has been deleted"). Reword only together with that file.
    raise exception 'submit_review: book for card % has been deleted', p_card_id;
  end if;

  new_reps       := coalesce((p_next_state->>'reps')::int, prev.reps + 1);
  new_stability  := (p_next_state->>'stability')::real;
  new_difficulty := (p_next_state->>'difficulty')::real;
  new_due_at     := (p_next_state->>'due_at')::timestamptz;
  new_state      := (p_next_state->>'state')::public.fsrs_state;

  if p_next_state ? 'learning_steps' then
    new_learning_steps := (p_next_state->>'learning_steps')::int;
  else
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("learning_steps is required"). Reword only together with that file.
    raise exception 'submit_review: learning_steps is required in p_next_state';
  end if;

  -- 118: the lazy upsert `start_session` has always had. `080` chose
  -- lazy-create over a trigger on auth.users deliberately -- a trigger there
  -- runs INSIDE Supabase's auth transaction, so a bug in it breaks signup for
  -- every account rather than degrading one feature ("unforgettable-but-total
  -- vs forgettable-but-bounded"; LifeOS chose bounded). That reasoning was
  -- re-verified before this migration and it holds.
  --
  -- WHY HERE AND NOT ELSEWHERE: `111` shipped the `raise` below on the
  -- reasonable belief that `080` guaranteed the row. It does not -- `080`'s
  -- ensure lives in start_session, and submit_review is a READER that was
  -- never covered. A caller reaching submit_review without start_session got
  -- a hard error on production. That gap is the ruling's own defect, not a
  -- coding slip: the ruling covered every writer and no reader.
  insert into public.user_settings (user_id) values (caller)
    on conflict (user_id) do nothing;

  select desired_retention into new_request_retention
    from public.user_settings where user_id = caller;
  if new_request_retention is null then
    -- Should be unreachable -- ensure_user_stats_settings (080) guarantees
    -- a user_settings row exists by the time a card is gradable. Fail
    -- loudly rather than silently write a null into a NOT NULL column via
    -- some other path if that guarantee is ever violated.
    raise exception 'submit_review: no user_settings row for caller % -- cannot record request_retention', caller;
  end if;

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
    stability_after, difficulty_after, scheduled_days,
    state_after, learning_steps_after, request_retention
  ) values (
    p_card_id, p_session_id, p_rating, p_confidence, p_elapsed_ms, p_answered_text, p_ai_feedback,
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
  where card_id = p_card_id and user_id = caller;

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

do $guard$
declare
  offenders text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into offenders
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and pg_get_functiondef(p.oid) ~* 'from[[:space:]]+public\.user_settings'
    and pg_get_functiondef(p.oid) !~* 'insert into public\.user_settings';

  if offenders is not null then
    raise exception
      '118 guard: function(s) read public.user_settings without ensuring the row exists: % -- add the lazy upsert (see 080) or this class of defect returns',
      offenders;
  end if;
end
$guard$;
