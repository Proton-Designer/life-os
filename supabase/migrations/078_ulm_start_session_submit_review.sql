-- ULM: the core retrieval loop RPCs — `start_session` + `submit_review`.
-- Sourced from ULM's `20260815040000_l1a_schema.sql`, grepped against every
-- later migration touching either function
-- (`20260815041000_l1a_fix_cross_owner_ref.sql`,
-- `20260815050000_l1a_soft_delete_and_purge.sql`) before writing this file.
--
-- Two prerequisite columns, both decided as forks before writing rather
-- than guessed:
--
-- `user_stats.total_reviews` — one of the five columns deferred when
-- user_stats landed (066); the other four (week_start_date,
-- sessions_this_week, freezes_used_total, total_sessions) are
-- `complete_session`'s week-boundary/freeze machinery and stay deferred.
-- `total_reviews` is a plain monotonic counter with no such dependency, and
-- `submit_review` is literally the function that maintains it — landed
-- together, same "thing and the state it depends on arrive together" rule
-- as every other table in this convergence.
--
-- `work_sessions.local_date` — `start_session`'s whole job is "resume
-- today's incomplete session, keyed on the user's local date," and there is
-- nowhere to keep that date. The alternative — deriving a calendar day from
-- `started_at::date` server-side — is AGENTS.md rule #2's bug class,
-- shipped four times in this repo. ULM's original `sessions.local_date`
-- existed for exactly this reason: the client computes the date once
-- against the user's real timezone and passes it in; the server compares,
-- never derives. Not a ULM import either — CollegeOS's `attempts` table
-- already stores a client-computed `local_date` the same way, so this is
-- consistency with an established platform pattern, not a special case.
-- CHECK is biconditional, not merely "nullable for non-learn": a 'learn'
-- row with a null local_date is a MALFORMED row that breaks resume
-- silently (the lookup finds nothing, a second session gets created, and
-- whatever streak logic reads local_date keys on nothing) — unlike 077's
-- counters, which are genuinely optional (a session can exist before any
-- cards are reviewed), a learn session without a local date is broken from
-- the moment it's created, so both invalid states are made unrepresentable.
--
-- Explicitly NOT added: `work_sessions.domain`. Retrieval sessions carry no
-- domain, deliberately — this is a decision, not a deferral. In LifeOS,
-- domain attribution is a CHECK-IN responsibility, not a session one:
-- Signal:Noise coverage (`lib/business/sn-ratio.ts`) reads
-- `checkin_allocations(domain, minutes)` via `checkins`, and never queries
-- `work_sessions` for a domain (confirmed by reading the actual query, not
-- assumed). A session-level domain would be a SECOND source of truth
-- competing with the user's own allocation: a user who does 20 minutes of
-- recall in a window they allocated to `deen` would have the session claim
-- `school` while the check-in claims `deen`, and coverage would have two
-- answers to one question. The time is attributed by the person who spent
-- it — that's the design. Deriving domain through `sources` -> course ->
-- class was considered and rejected for the same reason: it would
-- confidently file a book session under whatever domain the book sits in,
-- a claim about the user's time the user never made. Where `work_sessions`
-- IS read nearby (`lib/checkins/missed-hour-queries.ts`, finding hours with
-- a session but no covering check-in) it selects `started_at`/`ended_at`
-- filtered on `counts_toward_hours` — no domain there either.
--
-- 🔴 HARD DEPENDENCY, recorded here because of what `reviews` is:
-- `submit_review` below is ported from the BASE schema, WITHOUT the
-- soft-delete defensive check that
-- `20260815050000_l1a_soft_delete_and_purge.sql` later added (`select
-- deleted_at is not null from books where id = prev.book_id... raise
-- exception`) — that check needs `books.deleted_at`, which does not exist
-- in this batch. `get_session_queue` (071) shouldn't legitimately offer a
-- card from a soft-deleted book, so the gap is defence-in-depth today, not
-- an open path — but "shouldn't" and "can't" are different, and `reviews`
-- is append-only: a review accepted against a deleted book's card is
-- PERMANENT, unfixable by anything short of whole-account purge. **The
-- migration that adds `books.deleted_at` MUST add this check to
-- `submit_review` in the same migration** — the same "ship together" rule
-- as every RLS policy and ownership trigger in this convergence, just
-- applied to a defence-in-depth check instead of a primary one.

alter table public.user_stats
  add column total_reviews int not null default 0;

alter table public.work_sessions
  add column local_date date,
  add constraint work_sessions_local_date_learn_only
    check (
      (kind = 'learn' and local_date is not null) or
      (kind <> 'learn' and local_date is null)
    );

-- Resume looks up (user_id, local_date) filtered to kind='learn' — this
-- runs on every session start, the most frequent write path in the
-- product.
create index work_sessions_learn_user_local_date
  on public.work_sessions (user_id, local_date)
  where kind = 'learn';

-- start_session: reuse an incomplete 'learn' session from the same local
-- date instead of creating orphans. Local date is entirely client-supplied
-- (see header comment) — this function never derives a calendar date from
-- an instant.
create function public.start_session(p_local_date date)
returns public.work_sessions
language plpgsql
security invoker
as $$
declare
  caller uuid := auth.uid();
  existing public.work_sessions;
  created public.work_sessions;
begin
  if caller is null then
    raise exception 'start_session: no authenticated user';
  end if;

  select * into existing from public.work_sessions
    where user_id = caller and kind = 'learn' and local_date = p_local_date and ended_at is null
    order by started_at desc
    limit 1;

  if found then
    return existing;
  end if;

  insert into public.work_sessions (user_id, kind, local_date)
    values (caller, 'learn', p_local_date)
    returning * into created;

  return created;
end;
$$;

-- submit_review: single transaction — insert the immutable review row,
-- upsert card_states from the caller-computed next state, bump session and
-- account counters. FSRS math itself runs client-side (packages/core,
-- ts-fsrs); this RPC is the integrity gate: it validates the proposed
-- transition rather than trusting it blindly, so the review log and
-- card_states can never disagree with each other. It does NOT recompute
-- p_next_state — that would be a real architectural change (server-side
-- scheduling), not a port.
create function public.submit_review(
  p_card_id uuid,
  p_session_id uuid,
  p_rating smallint,
  p_elapsed_ms int,
  p_answered_text text,
  p_ai_feedback text,
  p_ai_suggested_rating smallint,
  p_next_state jsonb
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
begin
  if caller is null then
    raise exception 'submit_review: no authenticated user';
  end if;
  if p_rating not between 1 and 4 then
    raise exception 'submit_review: rating must be 1..4';
  end if;

  select * into prev from public.card_states
    where card_id = p_card_id and user_id = caller
    for update;

  if not found then
    raise exception 'submit_review: no card_states row for card % / user %', p_card_id, caller;
  end if;

  -- Concurrency: the reps invariant below is what makes two concurrent
  -- duplicate submits for the same card resolve to exactly one accepted
  -- row. The FOR UPDATE above serializes the second transaction behind the
  -- first; by the time it re-reads `prev`, the first submit has already
  -- advanced reps, so the second's `new_reps <> prev.reps + 1` check fails
  -- against the now-current reps — it does not silently accept a second
  -- write against stale state.
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
    card_id, session_id, rating, elapsed_ms, answered_text, ai_feedback,
    ai_suggested_rating, state_before, stability_before, difficulty_before,
    stability_after, difficulty_after, scheduled_days
  ) values (
    p_card_id, p_session_id, p_rating, p_elapsed_ms, p_answered_text, p_ai_feedback,
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
