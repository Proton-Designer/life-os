-- 160: #24/#25 -- reuse get_session_queue for CollegeOS questions, the
-- actual point of this batch. Depends on 157 (NOT EXISTS fix -- this is
-- the migration that finally ARMS the scenario 157 pre-empted), 158
-- (ordering hardening) and 159 (every class now guaranteed a course-kind
-- sources row) all landing first.
--
-- WHAT CHANGES, MINIMALLY. Both branches that read `card_states`
-- (`due_candidates`, `new_candidates`) gain a second arm, UNION ALL'd with
-- the existing card arm, for question-backed rows -- joined through
-- `questions.class_id` to a `kind='course'` sources row (159), exactly
-- parallel to how the card arm joins `books` to a `kind='book'` sources
-- row. `warm_up`'s stability/due_at pick, the NOT EXISTS exclusion (157),
-- the due-CTE's ORDER BY before its LIMIT (158), and the round-robin
-- ranking are all UNCHANGED logic, just now operating over the union of
-- both arms -- this is the whole mechanism of #25's cross-source
-- interleaving: a course is just another `sources` row with `kind =
-- 'course'`, and `source_rank`/`overall_rank` already round-robin by
-- `source_id`, not by book/course specifically.
--
-- RETURN SHAPE CHANGE: `question_id uuid` added to RETURNS TABLE, between
-- `card_id` and `book_id`. Exactly one of `card_id`/`question_id` is set
-- per row (mirrors `card_states_item_xor`); `book_id` is set iff `card_id`
-- is. PostgREST/Supabase RPC results are JSON objects keyed by column
-- name, so this is additive for any existing caller reading `row.card_id`/
-- `row.book_id` by name -- `fetchQueueEntries` (build-session.ts) is
-- updated in the same change to read the new field.
--
-- WHY A QUESTION HAS NO SUSPENSION FILTER: `cards.suspended_at` is the
-- lesson-adoption mechanism (126) -- ULM-specific, no equivalent exists for
-- a CollegeOS question, and none is invented here. `questions.active`
-- (111) is the one gate that exists, applied to both the due and new
-- question arms exactly where `books.deleted_at is null` gates the card
-- arms.
--
-- WHY THE `new` QUESTION ARM DOES NOT JOIN `sources`: neither does the
-- EXISTING card `new` arm (only `books`+`cards`) -- `sources` is only ever
-- needed for `source_rank`'s round-robin partition key, which `new_cards`
-- has never used (it row_numbers over `state_id` alone, unaffected by
-- which source an item belongs to). Adding an unnecessary join here would
-- be new behaviour, not a port of the existing pattern.
--
-- Transaction control is the RUNNER's -- no begin/commit in this file.

-- OUT-parameter composition changed (question_id added) -- Postgres refuses
-- CREATE OR REPLACE across a return-type change ("cannot change return type
-- of existing function ... Row type defined by OUT parameters is
-- different"), so the old signature must be dropped first. No explicit
-- GRANT/REVOKE exists anywhere in this repo's migrations for
-- get_session_queue (checked) -- it has only ever relied on Postgres's
-- default EXECUTE-to-PUBLIC, which CREATE FUNCTION re-establishes
-- identically, so nothing needs re-granting after the drop.
drop function if exists public.get_session_queue(integer, integer);

CREATE FUNCTION public.get_session_queue(p_limit_due integer, p_limit_new integer)
 RETURNS TABLE(card_id uuid, question_id uuid, book_id uuid, queue_position integer, reason text)
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
  with due_candidates as (
    select cs.id as state_id, cs.card_id, null::uuid as question_id, cs.book_id,
           s.id as source_id, cs.due_at, cs.stability
    from public.card_states cs
    join public.sources s on s.book_id = cs.book_id and s.kind = 'book'
    join public.books bk on bk.id = cs.book_id and bk.deleted_at is null
    join public.cards c on c.user_id = cs.user_id and c.id = cs.card_id
                       and c.suspended_at is null
    where cs.user_id = caller and cs.state <> 'new' and cs.due_at <= now()

    union all

    select cs.id as state_id, null::uuid as card_id, cs.question_id, null::uuid as book_id,
           s.id as source_id, cs.due_at, cs.stability
    from public.card_states cs
    join public.questions q on q.id = cs.question_id and q.active
    join public.sources s on s.class_id = q.class_id and s.kind = 'course'
    where cs.user_id = caller and cs.state <> 'new' and cs.due_at <= now()
  ),
  due as (
    select state_id, card_id, question_id, book_id, source_id, due_at, stability,
           row_number() over (partition by source_id order by due_at asc) as source_rank,
           row_number() over (order by due_at asc) as overall_rank
    from due_candidates
    order by due_at asc
    limit greatest(p_limit_due, 1) * 4
  ),
  warm_up as (
    select state_id, card_id, question_id, book_id, 0::int as queue_position, 'warm_up'::text as reason
    from due
    order by stability desc nulls last, due_at asc
    limit 1
  ),
  due_interleaved as (
    select card_id, question_id, book_id,
           (row_number() over (order by source_rank asc, overall_rank asc))::int as queue_position,
           'due'::text as reason
    from due
    where not exists (
      select 1 from warm_up w where w.state_id = due.state_id
    )
    limit greatest(p_limit_due - 1, 0)
  ),
  new_candidates as (
    select cs.id as state_id, cs.card_id, null::uuid as question_id, cs.book_id
    from public.card_states cs
    join public.books bk on bk.id = cs.book_id and bk.deleted_at is null
    join public.cards c on c.user_id = cs.user_id and c.id = cs.card_id
                       and c.suspended_at is null
    where cs.user_id = caller and cs.state = 'new'

    union all

    select cs.id as state_id, null::uuid as card_id, cs.question_id, null::uuid as book_id
    from public.card_states cs
    join public.questions q on q.id = cs.question_id and q.active
    where cs.user_id = caller and cs.state = 'new'
  ),
  new_cards as (
    select card_id, question_id, book_id,
           (row_number() over (order by state_id))::int as queue_position,
           'new'::text as reason
    from new_candidates
    limit greatest(p_limit_new, 0)
  )
  select card_id, question_id, book_id, queue_position, reason from warm_up
  union all
  select card_id, question_id, book_id, queue_position + 1, reason from due_interleaved
  union all
  select card_id, question_id, book_id, queue_position + 1000, reason from new_cards
  order by queue_position asc;
end;
$function$
;
