-- ULM: close the "no row provisioning" gap found while verifying 079.
-- Nothing creates a `user_stats`/`user_settings` row for a new user on this
-- platform — checked directly: no trigger on `auth.users`
-- (`select * from pg_trigger where tgrelid = 'auth.users'::regclass` finds
-- nothing). ULM's original design relied on a `handle_new_user()` trigger;
-- that was never ported here, and LifeOS's OWN `profiles` table uses a
-- different, deliberate pattern instead — lazy upsert on first real use
-- (`updateProfile()`'s own comment: "a brand-new auth user has no profiles
-- row yet... onboarding is what's expected to create it").
--
-- Consequence, demonstrated live against the scratch DB while verifying
-- 079: `complete_session` against a user with no `user_stats` row does not
-- error — it computes against an all-NULL record and returns
-- `current_streak: null, freezes_available: null` etc. `submit_review`'s
-- `update ... where user_id = caller` against a missing row matches zero
-- rows, also silently: `total_reviews` never increments, forever. Both are
-- the "verdict derived from silence" shape this whole convergence keeps
-- finding.
--
-- Option (b) — lazy upsert, matching LifeOS's own pattern — chosen over a
-- `handle_new_user()`-style trigger for a reason stronger than convention:
-- a trigger on `auth.users` runs INSIDE Supabase's auth transaction, so any
-- bug in it (a bad column reference, a constraint violation) breaks signup
-- for every account, not just this feature. A bug in a lazy-create call
-- degrades one call path. Unforgettable-but-total vs. forgettable-but-
-- bounded; LifeOS chose bounded for `profiles` and this platform keeps that
-- choice rather than reintroducing the other one for ULM's two tables.
--
-- Structural safeguard against the ensure itself drifting (three call
-- sites, same class of risk as the FSRS constants: one fact, several
-- implementations, free to diverge): every ensure below is
-- `insert (user_id) values (caller) on conflict (user_id) do nothing` —
-- no caller-supplied value for any other column, ever. The row's actual
-- shape comes entirely from the columns' own DEFAULTs
-- (`current_streak int not null default 0` and friends from 066, and every
-- deferred column landed since). No caller can specify a wrong value
-- because no caller specifies a value at all — same move as the generated
-- `counts_toward_hours` column: kill the drift hazard structurally, not by
-- discipline.
--
-- `start_session` gets it for BOTH tables, not just `user_stats` — it's the
-- only function that issues a `session_id`, so ensuring both rows here
-- covers `submit_review`/`complete_session` by construction, and it's also
-- where the client reads `user_settings` (session_target_minutes,
-- daily_new_limit) to build the queue limits, a TS-layer read this
-- migration can't reach directly but can guarantee a row exists for.
-- `submit_review` and `complete_session` get the `user_stats` ensure too —
-- with column defaults there's nothing to get wrong, so it's free
-- insurance against a future entry point that bypasses `start_session`.
--
-- Grepped every ULM migration for other direct SQL readers of either table
-- before writing this: only `submit_review` and `complete_session` touch
-- `user_stats` at the SQL layer (`update ... where user_id`, `select ...
-- for update`); nothing in any ported migration queries `user_settings`
-- from SQL at all — it's read exclusively from the TS layer, which is
-- exactly why `start_session` (the earliest point in the loop) is where its
-- row has to exist by the time that TS read happens.

create or replace function public.start_session(p_local_date date)
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

  insert into public.user_stats (user_id) values (caller) on conflict (user_id) do nothing;
  insert into public.user_settings (user_id) values (caller) on conflict (user_id) do nothing;

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

create or replace function public.submit_review(
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

  insert into public.user_stats (user_id) values (caller) on conflict (user_id) do nothing;

  select * into prev from public.card_states
    where card_id = p_card_id and user_id = caller
    for update;

  if not found then
    raise exception 'submit_review: no card_states row for card % / user %', p_card_id, caller;
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

create or replace function public.complete_session(p_session_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  caller uuid := auth.uid();
  sess public.work_sessions;
  stats public.user_stats;
  gap_days int;
  used_freeze boolean := false;
  freeze_consumed jsonb := null;
  effortful_win jsonb := null;
  v_book record;
  v_review record;
  v_deck_hit boolean;
begin
  if caller is null then
    raise exception 'complete_session: no authenticated user';
  end if;

  insert into public.user_stats (user_id) values (caller) on conflict (user_id) do nothing;

  select * into sess from public.work_sessions
    where id = p_session_id and user_id = caller and kind = 'learn'
    for update;

  if not found then
    raise exception 'complete_session: session % not found for caller', p_session_id;
  end if;

  -- Guard 1: true idempotency.
  if sess.ended_at is not null then
    select * into stats from public.user_stats where user_id = caller;
    return to_jsonb(stats) || jsonb_build_object('freeze_consumed', null, 'effortful_win', null);
  end if;

  update public.work_sessions set ended_at = now()
    where id = p_session_id;

  select * into stats from public.user_stats where user_id = caller for update;

  if stats.last_session_date is null then
    gap_days := null;
  else
    gap_days := sess.local_date - stats.last_session_date;
  end if;

  if gap_days is null or gap_days = 0 then
    if stats.current_streak = 0 then
      stats.current_streak := 1;
    end if;
  elsif gap_days = 1 then
    stats.current_streak := stats.current_streak + 1;
  elsif gap_days > 1 and stats.freezes_available > 0 and gap_days - 1 <= stats.freezes_available then
    stats.freezes_available := stats.freezes_available - (gap_days - 1);
    stats.freezes_used_total := stats.freezes_used_total + (gap_days - 1);
    stats.current_streak := stats.current_streak + 1;
    used_freeze := true;
  else
    stats.current_streak := 1;
  end if;

  stats.longest_streak := greatest(stats.longest_streak, stats.current_streak);

  -- Counts completed session rows. Guard 1 ensures this runs at most once
  -- per row, so two genuine same-day sessions each add 1.
  stats.total_sessions := stats.total_sessions + 1;

  -- Guard 2: distinct-active-day counter. Only advances on a genuinely new
  -- local day, not on "a call happened."
  if gap_days is null or gap_days <> 0 then
    if stats.week_start_date is null or sess.local_date >= stats.week_start_date + 7 then
      stats.week_start_date := sess.local_date - extract(dow from sess.local_date)::int;
      stats.sessions_this_week := 1;
    else
      stats.sessions_this_week := stats.sessions_this_week + 1;
    end if;
  end if;

  stats.last_session_date := sess.local_date;

  if stats.sessions_this_week = 7 and stats.freezes_available < 3 then
    stats.freezes_available := stats.freezes_available + 1;
  end if;

  update public.user_stats set
    current_streak = stats.current_streak,
    longest_streak = stats.longest_streak,
    freezes_available = stats.freezes_available,
    freezes_used_total = stats.freezes_used_total,
    last_session_date = stats.last_session_date,
    total_sessions = stats.total_sessions,
    week_start_date = stats.week_start_date,
    sessions_this_week = stats.sessions_this_week
  where user_id = caller;

  if used_freeze then
    freeze_consumed := jsonb_build_object(
      'count', gap_days - 1,
      'freezesRemaining', stats.freezes_available
    );
  end if;

  -- Priority 1: recovered card — this session rated a card Good/Easy that
  -- was rated Again at some point before this session's own reviews.
  if effortful_win is null then
    select r.card_id, c.lesson_id, c.prompt
      into v_review
      from public.reviews r
      join public.cards c on c.id = r.card_id
      where r.session_id = p_session_id
        and r.user_id = caller
        and r.rating in (3, 4)
        and exists (
          select 1 from public.reviews prior
          where prior.card_id = r.card_id
            and prior.user_id = caller
            and prior.rating = 1
            and prior.reviewed_at < r.reviewed_at
        )
      order by r.reviewed_at asc
      limit 1;
    if found then
      effortful_win := jsonb_build_object(
        'kind', 'recovered_card',
        'cardId', v_review.card_id,
        'lessonId', v_review.lesson_id,
        'prompt', v_review.prompt
      );
    end if;
  end if;

  -- Priority 2: comeback — first completed session after a gap of >= 2
  -- days, freeze-covered or not.
  if effortful_win is null and gap_days is not null and gap_days >= 2 then
    effortful_win := jsonb_build_object('kind', 'comeback', 'gapDays', gap_days);
  end if;

  -- Priority 3 (book_milestone) deliberately skipped — see 079's header comment.

  -- Priority 4: hard-won recall — rated Good/Easy after >30s thinking time,
  -- this session. Longest elapsed time first among qualifying reviews.
  if effortful_win is null then
    select r.card_id, c.lesson_id, c.prompt, r.elapsed_ms
      into v_review
      from public.reviews r
      join public.cards c on c.id = r.card_id
      where r.session_id = p_session_id
        and r.user_id = caller
        and r.rating in (3, 4)
        and r.elapsed_ms is not null
        and r.elapsed_ms > 30000
      order by r.elapsed_ms desc
      limit 1;
    if found then
      effortful_win := jsonb_build_object(
        'kind', 'hard_won_recall',
        'cardId', v_review.card_id,
        'lessonId', v_review.lesson_id,
        'prompt', v_review.prompt,
        'elapsedMs', v_review.elapsed_ms
      );
    end if;
  end if;

  -- Priority 5: deck complete — every card in a book touched this session
  -- now has at least one review, for the first time ever (write-once).
  if effortful_win is null then
    for v_book in
      select distinct b.id, b.title
      from public.reviews r
      join public.books b on b.id = r.book_id
      where r.session_id = p_session_id and r.user_id = caller
    loop
      exit when effortful_win is not null;
      if not exists (
        select 1 from public.cards c
        where c.book_id = v_book.id and c.user_id = caller
          and not exists (
            select 1 from public.card_states cs
            where cs.card_id = c.id and cs.user_id = caller and cs.reps > 0
          )
      ) then
        v_deck_hit := null;
        update public.books set deck_completed_at = now()
          where id = v_book.id and deck_completed_at is null
          returning true into v_deck_hit;
        if v_deck_hit then
          effortful_win := jsonb_build_object('kind', 'deck_complete', 'bookId', v_book.id, 'bookTitle', v_book.title);
        end if;
      end if;
    end loop;
  end if;

  -- Priority 6 (personal_best) cut outright — see 079's header comment.

  return to_jsonb(stats) || jsonb_build_object('freeze_consumed', freeze_consumed, 'effortful_win', effortful_win);
end;
$$;
