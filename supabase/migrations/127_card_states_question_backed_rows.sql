-- 127: make `111`'s question-backed scheduler rows actually representable.
--
-- WHAT IS BROKEN. `111` unified the scheduler across ULM cards and CollegeOS
-- questions: it added `card_states.question_id`, a composite FK to
-- `questions(user_id, id)`, a partial unique index on (question_id, user_id),
-- the `card_states_item_xor` check (`num_nonnulls(card_id, question_id) = 1`),
-- and a `card_states_derive_and_check` trigger with a full, working
-- question-backed branch that sets `book_id := null`.
--
-- It never dropped NOT NULL on `card_states.card_id`.
--
-- Exactly-one-of, plus `card_id` NOT NULL, leaves exactly one representable
-- shape. `question_id` can only ever be NULL. **A CollegeOS question cannot
-- have a scheduler row at all**, and every other piece of machinery `111` built
-- for them is unreachable. `111` is APPLIED TO PRODUCTION; this has been true
-- there since it landed.
--
-- Nothing fails today, which is the problem: there are no question-backed rows
-- to lose, so the defect is invisible until someone builds question review and
-- discovers the table refuses them. `111`'s own shape asserts (its lines 811,
-- 875) check `reviews.card_id` and the xor's definition — neither can see this.
--
-- HOW IT WAS FOUND, because the method transfers. While writing `126` I needed
-- an inner join to `cards` in `get_session_queue`, which is only safe if
-- question-backed rows are already excluded. I wrote the safety argument from
-- reading the constraints, and then tried to CREATE a question-backed row as a
-- control instead of trusting the argument. The insert was refused. The
-- argument was correct and the thing it described could not exist.
--
-- WHAT THIS FILE DOES NOT DO, and why, since the fix was scoped to more:
-- `card_states_book_id_matches_card` is `(book_id is not null) = (card_id is
-- not null)`. That ALREADY admits (card_id null, book_id null) — both sides
-- evaluate false and false = false is true — and it already rejects a
-- card-backed row whose book_id does not match. **It needs no rewrite, and
-- rewriting it would be a no-op change to a constraint on a production table.**
-- Proven by insert rather than by reading: with the NOT NULL dropped, a
-- question-backed row inserts and lands with book_id NULL, while a direct
-- UPDATE nulling a card-backed row's book_id is still refused by name.
-- Both-set and neither-set are still refused by name too, by the trigger.
--
-- Transaction control is the RUNNER's (R33) — no begin/commit in this file.

alter table public.card_states alter column card_id drop not null;

-- Shape assert, in `111`'s own style. This is the one thing `111` could have
-- had that would have caught its own gap: an assertion about what must be
-- REPRESENTABLE, not only about what must be rejected.
do $$
declare
  card_id_notnull boolean;
  xor_def         text;
  book_def        text;
begin
  select a.attnotnull into card_id_notnull
    from pg_attribute a
   where a.attrelid = 'public.card_states'::regclass and a.attname = 'card_id';
  if card_id_notnull is null then
    raise exception 'shape assert failed: card_states.card_id does not exist';
  elsif card_id_notnull then
    raise exception 'shape assert failed: card_states.card_id is still NOT NULL -- question-backed rows remain impossible';
  end if;

  select pg_get_constraintdef(oid) into xor_def
    from pg_constraint where conname = 'card_states_item_xor' and conrelid = 'public.card_states'::regclass;
  if xor_def is null or xor_def !~ 'num_nonnulls\(card_id, question_id\) = 1' then
    raise exception 'shape assert failed: card_states_item_xor missing or changed (found: %). Dropping NOT NULL without it would make BOTH-NULL representable.', coalesce(xor_def, 'MISSING');
  end if;

  select pg_get_constraintdef(oid) into book_def
    from pg_constraint where conname = 'card_states_book_id_matches_card' and conrelid = 'public.card_states'::regclass;
  if book_def is null then
    raise exception 'shape assert failed: card_states_book_id_matches_card is MISSING -- a card-backed row could carry a foreign book_id';
  end if;

  raise notice '127 shape asserts passed: card_id nullable, xor intact, book_id check intact.';
end $$;

comment on column public.card_states.card_id is
  'Nullable since 127. Exactly one of card_id/question_id is set (card_states_item_xor); book_id is non-null exactly when card_id is (card_states_book_id_matches_card), so a question-backed row carries neither. 111 built every other piece of this and left this column NOT NULL, which made the question-backed half unreachable on production until 127.';
