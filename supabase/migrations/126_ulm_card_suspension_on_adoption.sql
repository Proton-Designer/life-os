-- 126: adopted lessons leave the deck — Phase C, R64.
--
-- WHAT THIS CLOSES. `124` gave the loop seam its data: a promotion is a
-- commitment, a verdict is the judgement. It deliberately changed nothing on
-- the daily session's path, and said so. This file is the behaviour: when a
-- lesson is ADOPTED — the user reports they now actually do this — its cards
-- stop being asked. Until this migration, "adopted" was a row you could write
-- and nothing anywhere read.
--
-- WHY THE FACT HANGS OFF THE VERDICT LOG AND NOT OFF `lessons.status`.
-- `125` was allocated for `alter type lesson_status add value 'adopted'` and is
-- WITHDRAWN; the number is burned, not recycled. Three reasons, the third
-- decisive:
--   1. `get_session_queue` selects from card_states, sources and books and
--      never joins `lessons`. The status was invisible to the queue.
--   2. `archived` on that enum is the ingestion pipeline's own pre-promotion
--      holding state ("lost the merge"), not a user action.
--   3. `worker-stages.ts:392` promotes unconditionally to 'active' for any
--      lesson that yields cards, with none of the `status='archived'` scoping
--      the extraction stage guards itself with. A resumed `generating_cards`
--      stage would OVERWRITE `adopted` — no error, no wrong-looking value,
--      just a fact that quietly stops being true.
-- `lesson_verdicts` is append-only, enforced by trigger. A pipeline stage
-- cannot clobber it. That is the whole reason the mechanism hangs there.
--
-- WHAT IS DERIVED HERE, AND ITS CONDITION. `cards.suspended_at` duplicates a
-- fact the verdict log already carries, exactly as `lesson_promotions.retired_at`
-- does, and for the same reason: the hot path cannot afford to join the log on
-- every queue build. Same condition applies — NO CHECK, NO COLUMN.
-- `scripts/check-suspension-drift.sh` ships with this file and asserts the iff
-- in both directions. If it is deleted, delete these columns with it.
--
-- WHAT THIS DOES *NOT* CHANGE, stated so nobody has to infer it:
--   * Memory strength and review history. A suspended card keeps its
--     `card_states` row, its `reviews`, its stability. You did learn it; the
--     deck simply stops asking. Nothing here touches the append-only log.
--   * `get_book_detail`'s lesson and card counts. A suspended card still
--     counts as a card of that book. Changing that is a product decision, not
--     a consequence of this one.
--   * Un-suspension. There is no path back in this file. `adopted` is terminal
--     and retires the promotion (124); a later promotion of the same lesson can
--     be adopted again, and the trigger below is written so that the SECOND
--     adoption does not rewrite the FIRST suspension's timestamp.
--
-- Transaction control is the RUNNER's (R33) — no begin/commit in this file.
-- Nothing here is `alter type`, so this file is atomic, as it should be: three
-- statements that must not land apart.

-- ── 1. The suspension columns ───────────────────────────────────────────────
alter table public.cards
  add column if not exists suspended_at     timestamptz null,
  add column if not exists suspended_reason text        null;

-- The pair moves together or not at all. A `suspended_at` with no reason is a
-- card missing from the queue that nothing can explain.
alter table public.cards drop constraint if exists cards_suspension_pair;
alter table public.cards add constraint cards_suspension_pair
  check ((suspended_at is null) = (suspended_reason is null));

-- ONE legal reason today, and the CHECK is the point of the column rather than
-- an afterthought. `lesson_status` acquired a second meaning silently and that
-- is precisely the defect that withdrew `125`; here a second cause for a card
-- leaving the deck cannot be added without extending this list, which is a
-- visible decision in a migration someone has to write.
alter table public.cards drop constraint if exists cards_suspended_reason_known;
alter table public.cards add constraint cards_suspended_reason_known
  check (suspended_reason in ('promotion_adopted'));
-- No `is null or` guard: a CHECK evaluates to NULL for a NULL column and NULL
-- PASSES, so the guard is exact-equivalent noise. The draft had one.
--
-- NOT YET REGISTERED IN scripts/check-enum-drift.sh. That script is an opt-in
-- registry of table.column:typescript-file pairs, not a scan -- so it reports
-- OK on this constraint by never looking at it, and no green anywhere means
-- this vocabulary is checked. It cannot be paired today because nothing in
-- TypeScript names 'promotion_adopted' yet and pairing it against an invented
-- file would be manufacturing a consumer to satisfy a check. ADD THE PAIR the
-- moment the reason string first reaches TypeScript -- which is the moment the
-- UI explains why a card left the deck.


-- ── 2. The trigger: adoption suspends that lesson's cards ───────────────────
create or replace function public.suspend_cards_on_adopted_verdict()
returns trigger
language plpgsql
as $$
begin
  if new.verdict = 'adopted' then
    -- `c.suspended_at is null` is FIRST-SUSPENSION-WINS, not an optimisation.
    -- A lesson can be promoted again after a promotion retires, and adopted
    -- again; the honest timestamp is when the deck stopped asking, which is
    -- the first time, not the latest write.
    update public.cards c
       set suspended_at     = new.verdict_at,
           suspended_reason = 'promotion_adopted'
      from public.lesson_promotions p
     where p.id      = new.promotion_id
       and p.user_id = new.user_id
       and c.user_id = new.user_id
       and c.lesson_id = p.lesson_id
       and c.suspended_at is null;
  end if;
  return new;
end;
$$;

comment on function public.suspend_cards_on_adopted_verdict() is
  'Phase C / 126. Suspends every card of an adopted lesson so the daily session stops asking it. Reads the append-only verdict log rather than a status column deliberately -- see 126''s header for the three reasons 125 was withdrawn. Paired with scripts/check-suspension-drift.sh, which asserts the iff in both directions.';

drop trigger if exists trg_suspend_cards_on_adopted_verdict on public.lesson_verdicts;
create trigger trg_suspend_cards_on_adopted_verdict
  after insert on public.lesson_verdicts
  for each row execute function public.suspend_cards_on_adopted_verdict();

-- ── 2b. Cards created AFTER the adoption ────────────────────────────────────
-- The trigger above fires on a verdict. It cannot suspend a card that does not
-- exist yet — and cards for an existing lesson DO get recreated:
-- `generatingCards` does a delete-then-insert keyed on lesson_id, so a
-- re-ingest of an adopted lesson's book brings its whole deck back
-- UNSUSPENDED, with no verdict written and therefore nothing to fire on.
--
-- Found by asking what would make `check-suspension-drift.sh` go red in
-- production rather than by waiting for it to. Shipping the check without this
-- would mean shipping a column whose invariant I already knew broke.
create or replace function public.suspend_new_card_if_lesson_adopted()
returns trigger
language plpgsql
as $$
declare adopted_at timestamptz;
begin
  select min(v.verdict_at) into adopted_at
    from public.lesson_promotions p
    join public.lesson_verdicts v on v.promotion_id = p.id and v.user_id = p.user_id
   where p.user_id = new.user_id and p.lesson_id = new.lesson_id and v.verdict = 'adopted';

  if adopted_at is not null and new.suspended_at is null then
    new.suspended_at     := adopted_at;
    new.suspended_reason := 'promotion_adopted';
  end if;
  return new;
end;
$$;

comment on function public.suspend_new_card_if_lesson_adopted() is
  'Phase C / 126. A card inserted for an already-adopted lesson is born suspended -- generatingCards recreates decks by delete-then-insert, so without this a re-ingest silently returns an adopted lesson to the queue.';

-- BEFORE INSERT, not AFTER: it sets the row rather than re-updating it, so
-- there is never an instant where the card is queryable and unsuspended.
drop trigger if exists trg_suspend_new_card_if_lesson_adopted on public.cards;
create trigger trg_suspend_new_card_if_lesson_adopted
  before insert on public.cards
  for each row execute function public.suspend_new_card_if_lesson_adopted();

-- ── 3. Backfill: adoptions recorded BEFORE this trigger existed ─────────────
-- The trigger fires on INSERT. `124` shipped the verdict log; this file ships
-- the trigger. Any `adopted` verdict written in between — a different
-- environment, a different day, a manual repair — leaves its cards sitting in
-- the deck with nothing to ever suspend them, which is precisely the
-- `missed_retirement` shape `check-retired-at-drift.sh` exists to catch on the
-- other derived column. A trigger with no backfill only makes the invariant
-- true going forward, and going-forward invariants are the ones that get
-- reported as holding.
--
-- Uses the EARLIEST adopted verdict per lesson, not now(): the honest
-- timestamp is when the deck should have stopped asking. Idempotent
-- (`c.suspended_at is null`) and a silent no-op where there is nothing to
-- find, which is the expected case on production.
update public.cards c
   set suspended_at     = a.first_adopted_at,
       suspended_reason = 'promotion_adopted'
  from (
    select p.user_id, p.lesson_id, min(v.verdict_at) as first_adopted_at
      from public.lesson_promotions p
      join public.lesson_verdicts v on v.promotion_id = p.id and v.user_id = p.user_id
     where v.verdict = 'adopted'
     group by p.user_id, p.lesson_id
  ) a
 where c.user_id = a.user_id
   and c.lesson_id = a.lesson_id
   and c.suspended_at is null;

-- ── 4. The queue stops serving them ─────────────────────────────────────────
-- Replaced from the DEPLOYED definition (pg_get_functiondef) with two joins
-- inserted, rather than retyped from a migration file -- so everything that is
-- not the suspension filter is provably byte-identical to what runs today,
-- including 082's deliberately-redundant `bk.deleted_at is null` and the
-- `#variable_conflict use_column` this body depends on.
--
-- The join to `cards` is INNER, and it is safe under BOTH shapes this table
-- can have:
--   * TODAY: `card_states.card_id` is NOT NULL. With `card_states_item_xor`
--     (num_nonnulls(card_id, question_id) = 1) that leaves `question_id`
--     always NULL, so a question-backed row is not merely absent, it is
--     UNREPRESENTABLE. An inner join to cards can drop nothing.
--   * IF THAT NOT NULL IS EVER DROPPED — and `111` plainly intended it, since
--     it added the XOR, the question FK and the question unique index —
--     question rows are still excluded from both arms by their join to
--     `books` on `cs.book_id`, because `card_states_book_id_matches_card`
--     ties book_id's nullness to card_id's.
-- HONEST LIMIT: only the second is an argument; the first is what the exit
-- test could observe. I tried to CREATE a question-backed row as a control and
-- the insert was refused by that NOT NULL. So this is proven, not
-- demonstrated, and the reason it could not be demonstrated is itself a defect
-- reported to the LifeOS lead: `111` is applied to production and its
-- question-backed half cannot hold a row. If that is fixed, re-run this
-- migration's exit test with a real question-backed row present.
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
    -- 126: adopted lessons leave the deck. Inner join, placed INSIDE the CTE
    -- and ahead of its LIMIT, so a suspended card does not consume a slot the
    -- way a post-hoc filter would.
    join public.cards c on c.user_id = cs.user_id and c.id = cs.card_id
                       and c.suspended_at is null
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
    -- 126: same filter on the new-card arm. Both arms or neither -- a card
    -- suspended before it was ever seen must not be introduced.
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
