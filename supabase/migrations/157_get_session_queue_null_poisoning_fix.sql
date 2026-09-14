-- 157: close the NOT IN / NULL-poisoning landmine in get_session_queue's
-- due_interleaved CTE, BEFORE any question support is added to this
-- function. Flagged by the Opus architect's red-team of #24 ("reuse the
-- existing scheduler for questions"); fixed standalone, with its own test,
-- per that review's explicit instruction, ahead of every other change in
-- this batch.
--
-- THE BUG. due_interleaved's exclusion clause reads:
--
--   where card_id not in (select card_id from warm_up)
--
-- `127` dropped `NOT NULL` on `card_states.card_id` so a question-backed
-- row can exist with `card_id IS NULL`. SQL's `NOT IN` against a subquery
-- that contains even ONE NULL is famous for this: `x NOT IN (a, b, NULL)`
-- is never TRUE for any `x` -- it's FALSE when x equals a or b, and NULL
-- (never TRUE) otherwise, because `x <> NULL` is itself NULL, and
-- `FALSE OR FALSE OR NULL` is NULL, not FALSE. A WHERE clause keeps only
-- rows where the condition is TRUE, so the moment `warm_up`'s single row
-- has `card_id IS NULL` (a question won the warm-up pick), EVERY row in
-- `due_interleaved` gets excluded -- not just the warm-up row itself. The
-- user's due queue silently collapses to one card. No error, no warning:
-- the session just looks short.
--
-- NOT LIVE ON PRODUCTION TODAY -- verified, not assumed: `select count(*)
-- from card_states where question_id is not null` returns 0 (checked
-- 2026-09-14, this migration's authoring date). `card_id NOT NULL` is
-- currently unreachable for every row that could enter this function's
-- `due` CTE anyway, independent of this fix -- 126's due CTE already
-- INNER JOINs `public.cards` and `public.sources ... s.kind = 'book'` on
-- `cs.book_id`, and both joins reject a question-backed row (NULL
-- `card_id`/`book_id`) before it ever reaches `due_interleaved`. This is a
-- LATENT landmine, armed the moment `due`'s row source is widened to admit
-- question-backed card_states rows -- which is the literal next migration
-- in this batch (per the Opus Lead: fix this one FIRST, standalone,
-- before that widening lands).
--
-- THE FIX. `NOT EXISTS`, keyed on `card_states.id` -- the surrogate PK
-- `111` added specifically because `(card_id, user_id)` stopped being able
-- to serve as one once card_id went nullable. Two reasons this is safer
-- than `NOT IN (... where card_id is not null)`:
--   1. `id` is `NOT NULL` on every row of both shapes (card-backed and,
--      once 158 lands, question-backed) -- unlike `card_id`, there is no
--      NULL for `NOT EXISTS`'s correlated `=` to ever compare against, so
--      the three-valued-logic trap this bug depends on cannot recur here
--      structurally, not just because nobody has hit it yet.
--   2. `card_id not in (select card_id from warm_up where card_id is not
--      null)` was considered and rejected: once question rows exist, a
--      question-backed row that WINS warm_up would filter that guard's
--      subquery down to zero rows entirely (its only row's card_id is
--      NULL, filtered out by the added predicate) -- silently turning the
--      exclusion into a no-op, so the SAME warm-up row would ALSO appear
--      in due_interleaved as a duplicate. Keying on `id` instead of
--      `card_id` avoids this too: `warm_up`'s `id` is never NULL, so the
--      correlated NOT EXISTS excludes exactly the one row warm_up picked,
--      for either item shape.
--
-- SCOPE, DELIBERATELY MINIMAL. This migration changes exactly one thing:
-- `due`'s CTE now also projects `cs.id as state_id`, threaded through
-- `warm_up` and `due_interleaved` for the exclusion join only -- it is
-- never added to this function's RETURNS TABLE or its final SELECT list,
-- which stay byte-for-byte `card_id, book_id, queue_position, reason`,
-- exactly as `126` shipped them. Every other line of the deployed function
-- (the `bk.deleted_at is null` defence-in-depth, the `c.suspended_at is
-- null` join, the 4x LIMIT with no ORDER BY, the `cs.card_id` new-card
-- tiebreak) is reproduced VERBATIM from `pg_get_functiondef` against
-- production, not retyped from a migration file -- 126's own header
-- explains why that discipline matters. Those other defects (missing
-- ORDER BY before the 4x LIMIT; the new-card tiebreak) are real, already
-- flagged, and deliberately left for the NEXT migration in this batch --
-- this file's only job is the NULL-poisoning landmine, so it can be
-- reviewed, applied and proven safe on its own.
--
-- PROVEN NO-OP FOR BOOKS: see the exit tests run against this file
-- (BEGIN;...ROLLBACK; against production, reported alongside this file,
-- never applied by this migration itself per R33/the standing "no
-- migrations applied by an agent" rule) -- get_session_queue's output for
-- every real user is byte-identical, including queue_position and reason,
-- before and after this change.
--
-- Transaction control is the RUNNER's -- no begin/commit in this file.

CREATE OR REPLACE FUNCTION public.get_session_queue(p_limit_due integer, p_limit_new integer)
 RETURNS TABLE(card_id uuid, book_id uuid, queue_position integer, reason text)
 LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'get_session_queue: no authenticated user';
  end if;

  return query
  with due as (
    select cs.id as state_id, cs.card_id, cs.book_id, cs.due_at, cs.stability,
           row_number() over (partition by s.id order by cs.due_at asc) as source_rank,
           row_number() over (order by cs.due_at asc) as overall_rank
    from public.card_states cs
    join public.sources s on s.book_id = cs.book_id and s.kind = 'book'
    join public.books bk on bk.id = cs.book_id and bk.deleted_at is null
    join public.cards c on c.user_id = cs.user_id and c.id = cs.card_id
                       and c.suspended_at is null
    where cs.user_id = caller and cs.state <> 'new' and cs.due_at <= now()
    limit greatest(p_limit_due, 1) * 4
  ),
  warm_up as (
    select state_id, card_id, book_id, 0::int as queue_position, 'warm_up'::text as reason
    from due
    order by stability desc nulls last, due_at asc
    limit 1
  ),
  due_interleaved as (
    select card_id, book_id,
           (row_number() over (order by source_rank asc, overall_rank asc))::int as queue_position,
           'due'::text as reason
    from due
    where not exists (
      select 1 from warm_up w where w.state_id = due.state_id
    )
    limit greatest(p_limit_due - 1, 0)
  ),
  new_cards as (
    select cs.card_id, cs.book_id,
           (row_number() over (order by cs.card_id))::int as queue_position,
           'new'::text as reason
    from public.card_states cs
    join public.books bk on bk.id = cs.book_id and bk.deleted_at is null
    join public.cards c on c.user_id = cs.user_id and c.id = cs.card_id
                       and c.suspended_at is null
    where cs.user_id = caller and cs.state = 'new'
    limit greatest(p_limit_new, 0)
  )
  select card_id, book_id, queue_position, reason from warm_up
  union all
  select card_id, book_id, queue_position + 1, reason from due_interleaved
  union all
  select card_id, book_id, queue_position + 1000, reason from new_cards
  order by queue_position asc;
end;
$function$
;
