-- P2-17: the fourth effortful-win moment, `book_milestone` (a book crossing
-- 80% retention) — the follow-up design 079's own header comment already
-- laid out, executed now: `complete_session` takes per-book retrievability
-- as a PARAMETER, computed client-side (TypeScript, `lib/self-mastery/
-- memory-strength.ts`'s `averageRetrievability` — the same ts-fsrs
-- `get_retrievability` the Memory Strength bar itself uses, per that file's
-- own header on why the forgetting curve must live in exactly one place,
-- never hand-copied into SQL a second time), and this function does only
-- the write-once bookkeeping against those numbers.
--
-- STARTED FROM THE LIVE DEFINITION, NOT 079's FILE TEXT (Lead review
-- correction, stage 03 attempt 1): `pg_get_functiondef('public.
-- complete_session(uuid)')` on prod, diffed against 079's own migration
-- file, showed one real drift — migration 080 ("ensure_user_stats_settings")
-- added `insert into public.user_stats (user_id) values (caller) on
-- conflict (user_id) do nothing;` right after the auth check, fixing a
-- real bug (a user with no user_stats row previously finished a session
-- with a null `stats` return and streaks that never updated). 079's own
-- file text never got that fix folded back in, so rebuilding from 079
-- would have SILENTLY REVERTED 080's fix — a real regression, caught only
-- by diffing the live definition, not by re-reading history. Everything
-- below is the live body verbatim except: the new `p_book_strengths`
-- parameter, the new Priority 3 branch, and (unrelated to the drift) the
-- `key::uuid` cast guard described below.
--
-- DEVIATION FROM 079's header note, LOGGED HERE (also OPEN_QUESTIONS.md):
-- that note planned BOTH `milestone_50_at` and `milestone_80_at` landing
-- together. This migration adds ONLY `milestone_80_at`. The audit
-- (docs/audits/2026-09-13-three-app-feature-audit.md §5) and the
-- `EffortfulWinMoment` type both name exactly one celebrated threshold —
-- "a book crossing 80% retention" — and nothing in this codebase would
-- read a `milestone_50_at` column were it added: a written column with no
-- reader is the exact `lessons.embedding` mistake 079's own header already
-- refuses to repeat, just one threshold later. If a 50% milestone becomes
-- a real requirement (its own UI moment, not just data), add the column
-- together with whatever reads it, same rule as everywhere else.
--
-- WRITE-ONCE, RACE-SAFE: `update ... where milestone_80_at is null
-- returning ...` — the null check is the guard, not a prior SELECT, so two
-- concurrent completions of the same book can't both "win" the crossing.
--
-- INPUT VALIDATION (Lead review, stage 03 attempt 1): `p_book_strengths`
-- comes from this repo's own trusted server-side TS caller, but
-- `jsonb_each_text` + a blind `key::uuid`/`value::numeric` cast would still
-- raise and abort the ENTIRE session completion (streak/freeze bookkeeping
-- included) if a key or value were ever malformed — far too expensive a
-- failure mode for what should be a best-effort bonus check. The loop's
-- own query now filters to well-formed uuid keys and plain-decimal values
-- via regex before casting, so a malformed entry is silently skipped
-- (no book_milestone win that tick) rather than fatal.
--
-- GRANTS: no GRANT/REVOKE for this function exists anywhere in this repo's
-- migrations (same finding 160's own header already made for
-- get_session_queue) — Postgres grants EXECUTE to PUBLIC by default on a
-- freshly created function, which is exactly what's live today (PUBLIC +
-- postgres/anon/authenticated/service_role all show EXECUTE, all via that
-- same PUBLIC grant), so the drop+create below needs no explicit GRANT to
-- match current production.
alter table public.books
  add column milestone_80_at timestamptz;

-- Signature changed (new second parameter) — CREATE OR REPLACE would leave
-- the old 1-arg overload in place, and a caller passing only p_session_id
-- would then hit "function is not unique" against the two overloads. Drop
-- the old one explicitly, same pattern as 160/180's own signature changes.
drop function if exists public.complete_session(uuid);

create function public.complete_session(p_session_id uuid, p_book_strengths jsonb default '{}'::jsonb)
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
  v_book_id uuid;
  v_strength numeric;
  v_book_title text;
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

  -- Priority 3: book milestone (P2-17) — a book this session touched just
  -- crossed 80% average retrievability for the FIRST time. `p_book_strengths`
  -- is `{bookId: strength}` for every book this session reviewed, computed
  -- by the caller (build-session.ts's `computeSessionBookStrengths`, mirroring
  -- get-book-detail.ts's own Memory Strength calculation exactly — same
  -- function, same "every card in the book" scope, so this threshold means
  -- what the bar the user already sees means). Only book ids belonging to
  -- the caller are ever touched (composite `(user_id, id)` in the WHERE),
  -- so a forged/foreign id in the jsonb payload can update nothing. The
  -- regex filters below (not a blind cast) mean a malformed key or value
  -- is silently skipped rather than aborting the whole session completion.
  if effortful_win is null then
    for v_book_id, v_strength in
      select key::uuid, value::numeric
      from jsonb_each_text(coalesce(p_book_strengths, '{}'::jsonb))
      where key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and value ~ '^[0-9]*\.?[0-9]+$'
    loop
      exit when effortful_win is not null;
      continue when v_strength < 0.8;
      v_book_title := null;
      update public.books set milestone_80_at = now()
        where id = v_book_id and user_id = caller and milestone_80_at is null
        returning title into v_book_title;
      if v_book_title is not null then
        effortful_win := jsonb_build_object(
          'kind', 'book_milestone',
          'bookId', v_book_id,
          'bookTitle', v_book_title,
          'strength', v_strength
        );
      end if;
    end loop;
  end if;

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
