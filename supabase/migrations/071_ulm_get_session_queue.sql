-- ULM: `get_session_queue`, generalised to round-robin across `sources`
-- instead of `books` directly — the whole point of the `sources` table
-- (068/069). Ported from ULM's `20260815040000_l1a_schema.sql`, carrying
-- forward the three bug fixes from `2026081504[2-4]000` verbatim (read
-- before writing this file, per the Opus Lead's instruction, precisely so
-- none of them get reintroduced):
--   - `#variable_conflict use_column` — the RETURNS TABLE columns collide
--     with same-named columns selected in the query body otherwise
--     ("column reference is ambiguous").
--   - the final `order by` is a plain `order by queue_position asc`, not an
--     expression like `reason = 'warm_up' desc` (Postgres rejects an
--     expression against a UNION ALL result — "only result column names can
--     be used") — and it doesn't need to be an expression anyway, since
--     queue_position is already offset per branch (warm-up at 0, due
--     starting at 1, new starting at 1000).
--   - every `row_number()` is cast to `::int` at its source — it returns
--     bigint, but queue_position is declared int ("structure of query does
--     not match function result type").
--
-- The ONE substantive change from ULM's original: the due-cards CTE
-- partitions by `s.id` (source_id) instead of `cs.book_id` — round-robin
-- across sources, not books, which is what makes a book and a course
-- interleave once CollegeOS's `questions` table gets a `source_id` column
-- (their follow-up after 095-096). Joined through `sources.book_id =
-- card_states.book_id` rather than adding a `source_id` column to
-- `card_states` itself — card_states didn't need one; the 1:1 book<->source
-- relationship (068's partial unique index) makes the join exact.
--
-- The warm-up pick (`order by stability desc nulls last, due_at asc limit
-- 1`) is UNTOUCHED, per explicit instruction — it's source-agnostic already
-- and genuinely selects for ease; it is exactly the kind of thing that gets
-- accidentally "simplified" into "first due card" during a rewrite like
-- this one.
--
-- ⚠️ BOOKS-ONLY, VERIFIED AS SUCH — NOT "DONE." Until CollegeOS adds
-- `source_id` to `questions`, there is no course-side `card_states`
-- equivalent for this function to join against, so a course can never
-- appear in the queue no matter how correct this function is. D-003
-- requires book AND course cards interleaved; that half is structurally
-- unverifiable right now and is explicitly not claimed here.

create or replace function public.get_session_queue(p_limit_due int, p_limit_new int)
returns table (
  card_id uuid,
  book_id uuid,
  queue_position int,
  reason text
)
language plpgsql
security invoker
as $$
#variable_conflict use_column
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'get_session_queue: no authenticated user';
  end if;

  return query
  with due as (
    select cs.card_id, cs.book_id, cs.due_at, cs.stability,
           row_number() over (partition by s.id order by cs.due_at asc) as source_rank,
           row_number() over (order by cs.due_at asc) as overall_rank
    from public.card_states cs
    join public.sources s on s.book_id = cs.book_id and s.kind = 'book'
    where cs.user_id = caller and cs.state <> 'new' and cs.due_at <= now()
    limit greatest(p_limit_due, 1) * 4
  ),
  warm_up as (
    select card_id, book_id, 0::int as queue_position, 'warm_up'::text as reason
    from due
    order by stability desc nulls last, due_at asc
    limit 1
  ),
  due_interleaved as (
    select card_id, book_id,
           (row_number() over (order by source_rank asc, overall_rank asc))::int as queue_position,
           'due'::text as reason
    from due
    where card_id not in (select card_id from warm_up)
    limit greatest(p_limit_due - 1, 0)
  ),
  new_cards as (
    select cs.card_id, cs.book_id,
           (row_number() over (order by cs.card_id))::int as queue_position,
           'new'::text as reason
    from public.card_states cs
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
$$;
