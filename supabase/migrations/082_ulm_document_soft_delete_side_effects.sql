-- ULM: document two invariants found while sweeping every ported RPC/
-- trigger for the submit_review RLS-hides-the-check bug shape (081's
-- book_is_deleted fix). Both are comment-only — no behaviour change,
-- create-or-replace re-declaring the identical body.
--
-- 1. set_user_id_from_book (062, reused by source_chunks/lessons/cards/
--    ingestion_jobs): its fail-closed "book not found" lookup, combined
--    with books_own_row's RLS narrowing (081, deleted_at is null), means a
--    caller cannot insert a new row into their own SOFT-DELETED book —
--    RLS hides it from this trigger's own lookup, so it 404s exactly like
--    a genuinely missing book. Correct behaviour ("deleted books are
--    frozen for writes"), but nobody decided it — it emerges from the
--    intersection of two mechanisms that were each built for a different
--    reason. Someone loosening books_own_row to let owners see their own
--    soft-deleted books (a reasonable want for an "undelete" screen) would
--    silently unfreeze deleted books for writes, and no test would notice.
--
-- 2. get_session_queue (081)'s explicit `bk.deleted_at is null` join is
--    provably redundant against books_own_row's RLS today (a soft-deleted
--    book is invisible to its own owner's plain SELECT regardless), but
--    kept deliberately as defence in depth: if books_own_row ever stops
--    filtering deleted_at, this join still keeps soft-deleted books' cards
--    out of the queue. Two mechanisms enforcing the same outcome is only
--    waste when neither can fail independently — here they can, so it
--    stays.

create or replace function public.set_user_id_from_book()
returns trigger
language plpgsql
as $$
-- INVARIANT (see this migration's header): this function's fail-closed
-- "book not found" behaviour, combined with books_own_row's RLS narrowing
-- to deleted_at is null, means a caller cannot write a new child row
-- (book_sections/source_chunks/lessons/cards/ingestion_jobs) into their own
-- soft-deleted book — RLS hides it from the lookup below before this
-- function ever sees it, so it 404s indistinguishably from a genuinely
-- missing book. That is correct today ("deleted books are frozen for
-- writes") but is a CONSEQUENCE of this trigger plus that RLS policy, not
-- an explicit check either one performs. Loosening books_own_row to let an
-- owner see their own soft-deleted book (e.g. for an "undelete" screen)
-- would silently re-open writes to deleted books, and nothing here would
-- notice or prevent it.
declare
  owner uuid;
begin
  select user_id into owner from public.books where id = new.book_id;
  if owner is null then
    raise exception 'set_user_id_from_book: book % not found', new.book_id;
  end if;
  new.user_id := owner;
  return new;
end;
$$;

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
    -- `bk.deleted_at is null` is provably redundant against books_own_row's
    -- RLS today — a soft-deleted book is invisible to its own owner's plain
    -- SELECT regardless of this predicate. Kept anyway, deliberately, as
    -- defence in depth: if books_own_row ever stops filtering deleted_at,
    -- this join is what still keeps a soft-deleted book's cards out of the
    -- queue. Do not remove it as "redundant" without checking whether that
    -- RLS policy is still doing this job — see 082's header comment.
    join public.books bk on bk.id = cs.book_id and bk.deleted_at is null
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
    join public.books bk on bk.id = cs.book_id and bk.deleted_at is null
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
