-- ULM: `complete_session` — the core retrieval loop's ending. Streaks,
-- freezes, effortful wins. Grepped every ULM migration touching this
-- function before porting: `20260815040000_l1a_schema.sql` (base),
-- `20260815073000_l3_fix_complete_session_idempotency.sql` (the
-- idempotency fix, both guards below), `20260815090000_l4_complete_session_effortful_wins.sql`
-- (effortful-win detection, the richest and final version).
--
-- Four `user_stats` columns land here — the remaining ones deferred when
-- `user_stats` landed (066); `total_reviews` already landed with `078`.
-- This is the function that reads and writes all four
-- (`week_start_date`/`sessions_this_week` for the freeze-earning check,
-- `freezes_used_total`/`total_sessions` for the streak/freeze bookkeeping)
-- — same "thing and the state it depends on arrive together" rule as
-- everywhere else in this batch.
--
-- `books.deck_completed_at` lands here too — `deck_complete` (below) is its
-- only writer, landing together. `milestone_50_at`/`milestone_80_at` are
-- deliberately NOT added — see the `book_milestone` section below for why;
-- adding them with nothing to write them would be the exact
-- `lessons.embedding` mistake (a live column, no writer) this convergence
-- keeps finding and refusing to repeat.
--
-- 🔴 BOTH IDEMPOTENCY GUARDS MUST SURVIVE THE PORT — ULM shipped a real bug
-- here: calling this function twice for the same session minted an
-- illegitimate streak freeze on the second call (found live via
-- packages/core/src/session/smoke-test.ts). Two different guards for two
-- different meanings, per the original fix's own reasoning:
--   1. True idempotency: `sess.completed_at is not null` — a second call
--      for an already-completed session is a full no-op, returning the
--      stats as they already are, including never re-reporting
--      freeze_consumed/effortful_win. Protects every counter at once.
--   2. Distinct-active-day guard: `sessions_this_week`/`week_start_date`
--      only advance when `gap_days is null or gap_days <> 0` — i.e. on a
--      genuinely new local day, not on "a call happened." This is what
--      correctly lets two genuine same-day sessions each bump
--      `total_sessions` (a session-row count) while `sessions_this_week`
--      (a distinct-active-days count, per docs/specs/L4-engagement.md §1)
--      advances at most once per day regardless of how many sessions
--      happened.
--
-- 🔴 `book_milestone` is DEFERRED WITH A DESIGN, not cut (unlike
-- `personal_best`, which is cut outright per the Opus Lead's ruling — reads
-- as gamification under LifeOS's "an input metric is context for output,
-- never a score" rule). The brief names book-crossing-80%-retention
-- explicitly as an effortful-win type, so this is a real requirement, not
-- optional polish. It is deferred because its only implementation
-- (`book_memory_strength`, `20260815050000_l1a_soft_delete_and_purge.sql`)
-- hardcodes the FSRS-5 forgetting curve directly in SQL (`f = 19.0/81.0`,
-- `d = -0.5`, a hand-copied `power()` retrievability formula) — the exact
-- defect `packages/core/src/fsrs/index.ts`'s `getRetrievability()` exists
-- to prevent, and the bug propagating through a NEW caller rather than a
-- copy of the old one. If memory strength is TypeScript-only (which this
-- finding confirms it must be), any SQL that needs it is in the wrong
-- layer — `book_milestone` living inside this RPC was always going to
-- break eventually.
--
-- THE FOLLOW-UP DESIGN, recorded here so it isn't a blank slate: same
-- client-computes-server-validates split `submit_review` already uses (the
-- client computes `p_next_state` via ts-fsrs; the RPC bounds-checks it and
-- never recomputes). `complete_session` should take per-book strengths as
-- a PARAMETER, computed client-side by the one TS strength implementation
-- (LifeOS Engineer 2's), and do only the write-once milestone bookkeeping
-- ("has this book already crossed 50%/80%?") against those numbers — that
-- part is genuine database work, the curve is not. This keeps the
-- forgetting curve in exactly one place and makes `book_memory_strength`
-- unnecessary rather than merely wrong. Needs the TS strength function to
-- exist first and its parameter shape agreed with Engineer 2 — not
-- attempted here. `milestone_50_at`/`milestone_80_at` land in that
-- follow-up migration, together with the function that writes them.

alter table public.user_stats
  add column week_start_date     date,
  add column sessions_this_week  int not null default 0,
  add column freezes_used_total  int not null default 0,
  add column total_sessions      int not null default 0;

alter table public.books
  add column deck_completed_at timestamptz;

create function public.complete_session(p_session_id uuid)
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

  -- Priority 3 (book_milestone) deliberately skipped — see header comment.

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

  -- Priority 6 (personal_best) cut outright per the Opus Lead's ruling —
  -- reads as gamification under LifeOS's "an input metric is context for
  -- output, never a score" rule. Not ported, not deferred.

  return to_jsonb(stats) || jsonb_build_object('freeze_consumed', freeze_consumed, 'effortful_win', effortful_win);
end;
$$;
