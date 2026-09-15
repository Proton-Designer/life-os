-- 180: get_session_queue's `new` arm has no round-robin by source, unlike
-- the `due` arm right next to it. Found live (Opus Lead, ulm-demo account
-- d3a4edfb-6ebf-4564-93d9-e5a08fb695b1, 2026-09-14): a question created
-- through the panel got its card_states row (179's trigger fired, state
-- 'new'), but never appeared in a real review session -- confirmed via
-- `get_session_queue(20, 20)` returning 20 book cards and ZERO questions,
-- called directly as that user (set local role authenticated + jwt claims,
-- rolled-back txn), with new_cards_introduced = 0 that day (ruling out the
-- daily-limit as the cause).
--
-- ROOT CAUSE: `new_candidates` (160) is `book cards UNION ALL
-- question-backed rows`, with NEITHER arm joined to `sources` -- unlike
-- `due_candidates`, which joins both arms to `sources` specifically to
-- compute `source_id` for `source_rank`'s round-robin partition. The `new`
-- CTE's only order is `row_number() over (order by cs.id)` (158's own
-- fix -- a flat, single population, no partition by source at all). On an
-- account with 219 new book-backed card_states rows and 1 new
-- question-backed row, that question has roughly a 1/220 chance of
-- landing inside any given LIMIT window -- effectively never for a
-- student who also has a book backlog. #25's cross-source interleaving
-- (160's whole point) only ever held for the DUE arm; new items were never
-- actually round-robinned, they were flat-ordered by a random surrogate
-- key that happens to look plausible until a second source exists.
--
-- ALSO NOTE (158's own lesson, not a new defect): the prior `new_cards`
-- CTE's `limit greatest(p_limit_new, 0)` sat over a `row_number() over
-- (order by cs.id)` window with no ORDER BY of its own on the limited
-- query -- the exact unguaranteed-result-set shape 158 fixed for the DUE
-- arm's own 4x window. Fixed here in the same change, for the same reason:
-- this file already reproduces the `new` CTE from scratch to add
-- source_id, so there is no reason to reintroduce the identical hazard the
-- rewrite necessarily touches anyway.
--
-- FIX: mirror `due_candidates`/`due`'s own round-robin shape EXACTLY --
-- `new_candidates` gains a `source_id` on both arms via the SAME joins
-- `due_candidates` already uses (`sources` on `book_id`+kind='book' for
-- the card arm, on `class_id`+kind='course' for the question arm,
-- including the question arm's own `q.active` gate, unchanged) -- then a
-- `new_ranked` CTE computes `source_rank = row_number() over (partition by
-- source_id order by state_id)`, and `new_cards` selects
-- `order by source_rank asc, source_id asc, state_id asc` (an explicit,
-- deterministic ORDER BY directly on the limited query, per 158) before
-- `limit greatest(p_limit_new, 0)`.
--
-- WHY `state_id` (not something new) AS THE WITHIN-SOURCE TIEBREAK: 158's
-- own header already asked this question for the flat case and answered
-- it -- nothing downstream depends on which NEW card within a source is
-- introduced first, only that the order is deterministic and doesn't
-- cluster one item kind behind another. Keeping `state_id` here is the
-- same answer applied inside each source's own partition, not a fresh
-- invention.
--
-- WHY A SEPARATE `new_ranked` CTE AND NOT INLINING source_rank INTO
-- `new_cards`: `due` computes both `source_rank` and `overall_rank` in one
-- CTE, then `due_interleaved` consumes them -- this mirrors that same
-- two-step shape (rank, then select-with-final-queue_position) rather than
-- collapsing it, so a reader comparing the due and new arms side by side
-- sees the same structure twice, not two different idioms for the same
-- thing.
--
-- BLAST RADIUS: every user's NEW-card selection order changes (round-robin
-- by source instead of a flat cs.id order) -- for a SINGLE-BOOK user this
-- is a no-op in effect (one source has no other source to round-robin
-- against, so `source_rank` degenerates to the same `order by state_id`
-- 158 already produced) -- only WHICH new item comes first among several
-- sources changes, never which items are eligible. warm_up, due_interleaved,
-- and the return shape (`card_id, question_id, book_id, queue_position,
-- reason`, +1000 offset) are completely untouched -- every line not called
-- out above is reproduced verbatim from 160's deployed body.
--
-- POSITIVE CONTROL (required by the Lead before apply, reported alongside
-- this file, not embedded here — this repo's own convention, see 158's
-- header): seeded the bug's exact shape (one source with many new items,
-- a second source with one) in a rolled-back transaction against
-- production; the CURRENT (pre-180) function starved the second source
-- out of a small `p_limit_new` window, and the REPLACEMENT body below
-- returned it at queue_position 1001/1002 as expected.
--
-- Transaction control is the RUNNER's -- no begin/commit in this file.

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
  -- 180: gains `source_id` on BOTH arms, via the SAME joins due_candidates
  -- already uses -- see this file's header. Everything else about these
  -- two SELECTs (the q.active gate, the book deleted_at/suspended_at
  -- gates, the state = 'new' filter) is reproduced verbatim from 160.
  new_candidates as (
    select cs.id as state_id, cs.card_id, null::uuid as question_id, cs.book_id, s.id as source_id
    from public.card_states cs
    join public.sources s on s.book_id = cs.book_id and s.kind = 'book'
    join public.books bk on bk.id = cs.book_id and bk.deleted_at is null
    join public.cards c on c.user_id = cs.user_id and c.id = cs.card_id
                       and c.suspended_at is null
    where cs.user_id = caller and cs.state = 'new'

    union all

    select cs.id as state_id, null::uuid as card_id, cs.question_id, null::uuid as book_id, s.id as source_id
    from public.card_states cs
    join public.questions q on q.id = cs.question_id and q.active
    join public.sources s on s.class_id = q.class_id and s.kind = 'course'
    where cs.user_id = caller and cs.state = 'new'
  ),
  -- 180: the new arm's own round-robin rank, mirroring `due`'s
  -- source_rank exactly -- partition by source, order by the same stable
  -- tiebreak (`state_id`) 158 already established for this population.
  new_ranked as (
    select state_id, card_id, question_id, book_id, source_id,
           row_number() over (partition by source_id order by state_id) as source_rank
    from new_candidates
  ),
  new_cards as (
    select card_id, question_id, book_id,
           (row_number() over (order by source_rank asc, source_id asc, state_id asc))::int as queue_position,
           'new'::text as reason
    from new_ranked
    -- 180: explicit ORDER BY directly on the limited query -- 158's own
    -- lesson, applied here too rather than reintroduced.
    order by source_rank asc, source_id asc, state_id asc
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

-- Shape asserts: prove the REPLACEMENT actually has the round-robin
-- machinery the header claims, not just that the function still exists.
do $$
declare
  src text;
begin
  select pg_get_functiondef('public.get_session_queue(integer, integer)'::regprocedure) into src;

  if src !~ 'new_ranked' then
    raise exception 'shape assert failed: get_session_queue has no new_ranked CTE -- the new-arm round-robin rank is missing';
  end if;
  -- Both arms of new_candidates must each carry their own `sources` join
  -- (book-kind for cards, course-kind for questions) -- exactly two
  -- occurrences of `s.id as source_id` in the whole function (one due-arm
  -- book join, one due-arm question join were already there from 160; 180
  -- adds a further two for the new arm -- four total).
  if (select count(*) from regexp_matches(src, 's\.id as source_id', 'g')) <> 4 then
    raise exception 'shape assert failed: expected source_id to be joined on exactly 4 arms (due card, due question, new card, new question), found %',
      (select count(*) from regexp_matches(src, 's\.id as source_id', 'g'));
  end if;
  if src !~ 'partition by source_id order by state_id' then
    raise exception 'shape assert failed: new_ranked is not partitioning by source_id -- the round-robin fix did not land';
  end if;
end $$;
