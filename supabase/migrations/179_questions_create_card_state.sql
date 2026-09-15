-- 179: Phase 1 #24 -- every new question gets a card_states row, structurally,
-- the same guarantee 069 (books) and 159 (classes) already give their own
-- parent tables. THE REAL GAP: get_session_queue and submit_question_review
-- both require a card_states row keyed on question_id (card_states_item_xor,
-- 111) -- submit_question_review's own error text ("no card_states row for
-- question % / user %") is already a LOAD-BEARING string matched by
-- offline-queue.ts's isPermanentFailure, meaning the gap was anticipated on
-- the read/write side before anything closed it. Nothing ever did, until this.
--
-- NOT SECURITY DEFINER, mirroring create_class_source (159) exactly -- runs
-- as the inserting user. card_states' own RLS insert policy
-- (card_states_own_row, WITH CHECK user_id = auth.uid()) admits this: the
-- trigger fires inside the same request as the questions insert, under the
-- same auth.uid() that owns the question, so the check passes the same way
-- any other authenticated insert into card_states would. Verified against
-- the live policy, not assumed.
--
-- INITIAL VALUES COPIED FROM THE REAL CARD-INGESTION PATH
-- (lib/self-mastery/ingestion/worker-stages.ts), not invented: that insert
-- sets exactly card_id, user_id, book_id, state='new' and touches nothing
-- else -- due_at/stability/difficulty stay null, no defaults exist for them
-- and none are fabricated here. This trigger is that same shape for the
-- question side: question_id, user_id, state='new' (book_id has no meaning
-- for a question-backed row and is left for card_states_derive_and_check,
-- 070, to set to null itself, the same as it already does for any
-- question-backed insert regardless of who performs it).
--
-- card_states' OWN BEFORE INSERT trigger (card_states_derive_and_check, 070)
-- independently re-derives book_id (null, for a question) and re-validates/
-- overwrites user_id from auth.uid() when a real caller session exists --
-- this trigger's own explicit user_id is therefore belt-and-suspenders, not
-- load-bearing, but set anyway to match the book-side insert's own explicit
-- shape and to keep the row correct even under a service-role caller with no
-- auth.uid() (070's own "when set without a caller session" branch).
--
-- SATISFIES get_session_queue's new_candidates filter on arrival, not just
-- "a row exists": that CTE requires card_states.state = 'new' AND the joined
-- questions.active = true. state='new' is set explicitly here;
-- questions.active defaults to true (111) and this trigger never touches it.
--
-- BACKFILL: idempotent (where not exists), matching 159's own discipline,
-- even though questions has zero rows today (verified) -- this migration
-- must stay correct the day that stops being true, not just now.
--
-- Transaction control is the runner's (apply-migration.sh, --single-
-- transaction) -- no begin/commit in this file, per ALLOCATIONS.md's rule.

create or replace function public.create_question_card_state()
returns trigger
language plpgsql
as $$
begin
  insert into public.card_states (question_id, user_id, state) values (new.id, new.user_id, 'new');
  return new;
end;
$$;

comment on function public.create_question_card_state() is
  '179: question-side twin of 069''s create_book_source() / 159''s create_class_source(). Makes a question without a matching card_states row impossible -- #24''s real gap. get_session_queue and submit_question_review both require this row (card_states_item_xor); nothing created it before this.';

drop trigger if exists questions_create_card_state on public.questions;
create trigger questions_create_card_state
  after insert on public.questions
  for each row execute function public.create_question_card_state();

-- Backfill, idempotent (`where not exists`) -- safe against a question that
-- somehow already has a card_states row (shouldn't happen pre-trigger, but
-- this is a backfill, not a steady-state assumption; the partial unique
-- index questions_user_id_id_key's counterpart on card_states
-- (card_states_question_user_key) would reject a second one anyway).
insert into public.card_states (question_id, user_id, state)
select q.id, q.user_id, 'new'
from public.questions q
where not exists (select 1 from public.card_states cs where cs.question_id = q.id);

-- Shape assert -- prove what actually landed, not merely that nothing errored.
do $$
declare
  missing int;
  bad_state int;
begin
  select count(*) into missing
    from public.questions q
    where not exists (select 1 from public.card_states cs where cs.question_id = q.id);
  if missing > 0 then
    raise exception '179 shape assert failed: % question(s) still have no card_states row', missing;
  end if;

  -- Every question's card_states row must actually satisfy get_session_queue's
  -- new_candidates filter (state='new') -- proves the row is USABLE, not just present.
  select count(*) into bad_state
    from public.questions q
    join public.card_states cs on cs.question_id = q.id
    where cs.state <> 'new';
  if bad_state > 0 then
    raise exception '179 shape assert failed: % question(s) have a card_states row not in state ''new''', bad_state;
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'questions_create_card_state' and tgrelid = 'public.questions'::regclass) then
    raise exception '179 shape assert failed: questions_create_card_state trigger missing';
  end if;

  raise notice '179 shape asserts passed: every question has a card_states row in state ''new'', trigger present.';
end $$;
