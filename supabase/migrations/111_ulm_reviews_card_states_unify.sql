-- ULM: R1 -- reviews becomes THE append-only log for cards AND questions;
-- card_states is demoted to a derived, rebuildable cache. Number 111
-- allocated by the LifeOS lead (R5), 2026-09-02. Design history, the full
-- reasoning behind every decision below, and everything explicitly NOT done
-- here: ULM/docs/notes/r1-reviews-card-states-migration-draft.md.
--
-- GATING STATUS AT WRITE TIME: the SCHEMA below is cleared to land -- R1.6
-- proof 1 (single-review replay) is green, and this migration does not
-- depend on proof 2 (multi-review). The DEMOTION POLICY (card_states no
-- longer treated as authoritative by callers, the drift instrument's
-- guarantees) is a separate question the Opus Lead has said still waits on
-- Eng 2's Card B mechanism -- landing this schema is not the same as
-- flipping that policy. Apply to SCRATCH ONLY via ./scripts/apply-migration.sh,
-- hand off for production per the standing hard conditions.
--
-- CONTENTS, four things riding together per the Opus Lead's consolidation:
-- 1. The unified review log (R1.2) -- reviews.card_id nullable,
--    question_id + composite FK + XOR check, book_id nullable + biconditional.
-- 2. The `lapses` fix, proven live on production (a real row:
--    rebuilt=0 cached=1 MISMATCH, every other field matching) -- five
--    consecutive redefinitions (078/080/081/085/088) copied the wrong
--    formula forward unexamined.
-- 3. `reviews.request_retention` -- closes the drift-instrument blind spot
--    (Mode 2 needs it; without it, recompute-based drift detection cannot
--    tell a real scheduler regression from a user's retention setting
--    having changed between reviews).
-- 4. `reviews.state_after` -- approved after two engineers (this file's
--    author, building rebuildSchedulerCache; Eng 2, building the drift
--    check) independently hit the identical missing-column gap from the
--    same requirement text, without seeing each other's work.
-- 5. R17 -- `card_states.learning_steps` / `reviews.learning_steps_after`.
--    LifeOS lead's own live-production finding: `toFsrsCard` hardcodes
--    `learning_steps: 0` on every re-hydration, so a card graded only
--    Again/Hard/Good across separate sessions can never graduate out of
--    `learning`. THE DDL BELOW IS MINE; the TypeScript fix
--    (toFsrsCard/NextStateForRpc/toRpcNextState, the offline queue) is
--    LifeOS Eng 1's (9fh3zave), confirmed directly with them -- landing in
--    their own commit once these columns exist, not touched here.
--
-- REQUEST_RETENTION IS SERVER-DERIVED, NOT CLIENT-PASSED -- a design
-- decision this file makes that the draft doc's earlier sketch left open.
-- submit_review's signature gains NO new parameter for it. Reading
-- `user_settings.desired_retention` for the caller, inside the function,
-- server-side, is the same "never trust the client for a value that should
-- be authoritative" posture already used for user_id/book_id derivation
-- everywhere else in this schema -- a client-passed retention value could
-- be stale (read before a settings save completed) or simply wrong, and
-- the entire point of this column is recording what was ACTUALLY in force,
-- not what a client claimed was in force.

-- ============================================================================
-- CORRECTION, 2026-09-02: this file previously referenced `public.questions`
-- as already existing ("Composite target already exists: 097 created
-- questions_user_id_id_key") without actually containing the CREATE TABLE
-- that makes that true. Verified during production apply, not caught by
-- scratch testing beforehand: scratch already had `questions` from an
-- earlier, separate `095`/`097` apply, so `grep -c "create table"` on this
-- file (0 matches) would have shown the gap immediately if run, and it
-- wasn't run until the LifeOS lead ran it against the failure. Production
-- was left partially migrated (everything up to the FK below applied; the
-- FK itself and everything after it did not) -- see `112` (or its own
-- completion file) for the production-specific repair. This file, fixed
-- below, is what a genuinely clean database needs going forward.
-- ============================================================================
--
-- ATOMICITY (R33): THE TRANSACTION IS OWNED BY THE RUNNER, NOT THIS FILE.
-- apply-migration.sh now defaults to --single-transaction, and rejects any
-- file containing a bare top-level begin;/commit;/rollback; -- Postgres has
-- no nested transactions, so a file-level BEGIN/COMMIT alongside the
-- runner's own would either no-op or commit the runner's transaction early,
-- silently moving the atomicity guarantee from "one place, always on" to
-- "whichever file remembered to ask for it." An earlier version of this
-- file DID wrap itself in begin;/commit; (a real, then-necessary fix for a
-- real problem -- twice tonight a mid-file failure left everything before
-- it committed and unrollbackable, because neither the file nor the runner
-- owned a transaction) -- removed once the runner took over that job, not
-- because the reasoning was wrong. If you are reading this while copying
-- 111 as a template and wondering why there's no transaction wrapper here:
-- there doesn't need to be one, apply-migration.sh supplies it, and adding
-- one back will be refused. The shape-assertion block near the end of this
-- file still RAISEs on any mismatch, and that RAISE still rolls back
-- everything in this file -- via the runner's transaction now, not a
-- private one.
-- ============================================================================

-- ============================================================================
-- Part 0: questions (CollegeOS lead's half, folded in per Boss ruling --
-- reviews.question_id's composite FK needs this table and its unique index
-- to exist FIRST; every free migration number was above 111, so a separate
-- file would sort after the file that depends on it. One set, one number.
-- Source: former 095_school_questions.sql + the questions half of
-- 097_school_composite_fks.sql; the attempts half of 097 is withdrawn
-- (R1.2) and kept as rationale in migrations/_withdrawn/. The composite FK
-- to classes is declared inline here, not created-then-dropped-then-
-- re-added the way 097 had to when it ran after 095 -- the unsafe
-- single-column form never exists at any point.)
-- ============================================================================

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- NOT a single-column `references classes(id)`. FK checks bypass RLS, so that form
  -- proves only that the class EXISTS, never that the caller owns it -- user A could
  -- insert their own row pointing at user B's class and RLS would allow it, because the
  -- policy only checks the row's own user_id. The composite constraint at the foot of
  -- this table makes ownership part of the referenced key.
  class_id uuid not null,

  prompt text not null check (length(btrim(prompt)) > 0),
  answer text not null check (length(btrim(answer)) > 0),

  -- Where in the source material this came from. Required OR explicitly skipped --
  -- never silently absent. A question with no anchor and no acknowledgement that it
  -- lacks one is a question nobody can check against the source months later, and
  -- the whole point of the bank is that it stays checkable.
  source_anchor text null,
  source_skipped boolean not null default false,

  topic text null,

  -- self  = the user wrote it (the generation effect; the highest-retention path)
  -- ai    = drafted by a model, then edited by the user before it entered the bank
  -- missed = converted from something they got wrong on a real assessment
  origin text not null default 'self' check (origin in ('self','ai','missed')),

  -- Retired rather than deleted: reviews reference questions, and deleting a
  -- question would silently rewrite the user's own history of what they practised.
  -- Note this governs the question-level action only -- there is no delete-a-question
  -- affordance. Deleting a CLASS still cascades to its questions and onward to their
  -- reviews, which is deliberate but destroys that course's calibration history; the
  -- class-deletion UI owes the user a confirm that names what is lost.
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The anchor invariant, enforced in the schema rather than in a form validator:
  -- either it is present, or the user explicitly said there isn't one.
  constraint questions_anchor_present_or_skipped
    check (source_skipped or (source_anchor is not null and length(btrim(source_anchor)) > 0)),

  -- Composite, ownership-carrying. See the class_id comment above.
  --
  -- WHY A CONSTRAINT AND NOT A TRIGGER: the obvious alternative -- a BEFORE INSERT
  -- trigger checking ownership -- runs as the invoking user, so its lookup is subject
  -- to that user's RLS. Reading B's class returns NULL, and `if owner <> new.user_id`
  -- is NULL rather than TRUE, so the guard never fires against the exact attack it
  -- exists to stop, while passing review looking correct. The same RLS bypass that
  -- makes the single-column FK exploitable is what makes the composite FK airtight.
  --
  -- COLUMN ORDER IS (user_id, id), NOT (id, user_id) -- it must match the existing
  -- index `classes_user_id_id_key` created by 058:65. The reversed pair is a different
  -- index and nothing covers it.
  constraint questions_class_id_fkey
    foreign key (user_id, class_id) references public.classes (user_id, id)
    on delete cascade
);

alter table public.questions enable row level security;

drop policy if exists "questions_own_row" on public.questions;
create policy "questions_own_row" on public.questions
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- The queue reads active questions for a user's classes, ordered by what is due --
-- which is derived, so the index that matters is the one narrowing to the candidate
-- set before replay happens.
create index if not exists questions_user_class_active_idx
  on public.questions (user_id, class_id) where active;

comment on table public.questions is
  'Retrieval-practice questions, one per class. Scheduler state is NOT stored here -- it is replayed from public.reviews (R1.2).';
comment on column public.questions.source_anchor is
  'Where in the source this came from. Required unless source_skipped is true.';
comment on column public.questions.active is
  'Retired questions stay for review history. Never hard-delete a practised question.';

-- `reviews.question_id`'s composite FK (later in this file) needs this as its target.
-- Unique on (user_id, id) is redundant with the primary key -- `id` is already unique,
-- so the pair trivially is -- and exists solely to be referencable. Same trick 058 used
-- on `classes`.
create unique index if not exists questions_user_id_id_key
  on public.questions (user_id, id);

comment on constraint questions_class_id_fkey on public.questions is
  'Composite: a question can only reference a class the same user owns. FK checks bypass RLS, so ownership must be part of the referenced key.';

-- ============================================================================
-- Part 1: reviews
-- ============================================================================

alter table public.reviews
  alter column card_id drop not null,
  alter column book_id drop not null;

alter table public.reviews
  add column if not exists question_id uuid,
  add column if not exists correct boolean,
  add column if not exists request_retention real;

alter table public.reviews
  add column if not exists state_after public.fsrs_state;

-- BACKFILL PHASE. reviews is append-only (072) -- reject_review_mutation()
-- raises on ANY UPDATE, no role exemption, which includes this migration's
-- own backfill UPDATEs below. Caught by actually applying this to scratch,
-- not assumed: the first draft of this file failed here outright ("reviews
-- is append-only (attempted UPDATE)") before this disable/enable bracket
-- was added. Same narrow, documented-door pattern purge_user_data uses for
-- its one sanctioned exception -- disabled for the shortest possible span,
-- re-enabled immediately after, both statements inside it belonging to
-- this migration's backfill and nothing else.
alter table public.reviews disable trigger reviews_no_update;

update public.reviews set request_retention = 0.90 where request_retention is null;
-- Backfill justification: every existing row (23 on production, 5 on
-- scratch, per the pre-migration audit in the draft doc) was written while
-- every one of the 7 production users sat at desired_retention = 0.90 (the
-- brief default) with no evidence any of them ever changed it. 0.90 is the
-- recorded truth for these rows, not a convenient guess standing in for
-- missing data.

-- Tier 1 backfill (free, zero computation): for any review that is NOT its
-- card's most recent, the resulting state is already stored as the NEXT
-- review's state_before.
--
-- `order by reviewed_at, id` -- not `reviewed_at` alone. Found live during
-- the R24 cold re-verify: `now()` is frozen for an entire transaction in
-- Postgres, so a verification script chaining several submit_review calls
-- inside one transaction (exactly what the cold-verify test did) produces
-- several reviews with byte-identical `reviewed_at` -- `lead()`'s ordering
-- among ties is then undefined, and it visibly picked the wrong neighbour in
-- that test. Real, separate `submit_review` RPC calls in production are
-- separate transactions with genuinely distinct timestamps, so this was not
-- observed to bite production data -- but nothing GUARANTEED distinct
-- timestamps, and `id` (a random uuid) is a free, always-available
-- tiebreaker that makes the ordering deterministic regardless. Cheap
-- insurance against a genuine tie (e.g. two rapid submits landing in the
-- same millisecond), not a fix for an observed production bug.
with next_review as (
  select id, lead(state_before) over (partition by card_id order by reviewed_at, id) as next_state_before
  from public.reviews
)
update public.reviews r
set state_after = nr.next_state_before
from next_review nr
where r.id = nr.id and nr.next_state_before is not null;
-- On today's data this backfills ZERO rows -- checked, not assumed: 28
-- reviews across 28 distinct cards, each reviewed exactly once, so every
-- row IS its card's only/latest review and Tier 1's lead() window is null
-- for all 28. The query is still correct and still belongs here -- it is
-- what makes every FUTURE review's backfill free the moment a second
-- review lands on any card.

alter table public.reviews enable trigger reviews_no_update;
-- Re-enabled immediately -- the window above covers exactly these two
-- backfill statements and nothing written after this line relies on the
-- trigger being off. The follow-up migration's own backfill UPDATE
-- (learning_steps_after, once state_after's Tier 2 script has run) needs
-- the identical disable/enable bracket -- stated in this file's closing
-- note so it isn't rediscovered by another failed apply.

-- REAL BLOCKER FOUND WHILE VERIFYING ON SCRATCH, NOT ANTICIPATED IN THE
-- DESIGN DOC: scripts/backfill-review-state-after.ts (the Tier 2 backfill,
-- run against a real PostgREST-backed environment) writes via supabase-js's
-- `.update()` -- a data operation over the REST API. PostgREST has no way
-- to run `ALTER TABLE ... DISABLE TRIGGER` at all (it is schema DDL, not a
-- table operation PostgREST exposes), so that script's writes hit the exact
-- same "reviews is append-only" rejection this migration's own backfill
-- did above, with NO way for the script itself to open the same narrow
-- door. Fix: a single-purpose SECURITY DEFINER RPC that opens and closes
-- the door WITHIN one call, so the caller (the script, via supabase-js's
-- `.rpc()`) never needs -- or gets -- direct trigger-toggling power.
-- Verified this actually works on scratch (a SECURITY DEFINER function CAN
-- disable/update/enable inline) before writing it in here as fact.
create or replace function public._backfill_review_state_after(p_id uuid, p_state_after public.fsrs_state)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  alter table public.reviews disable trigger reviews_no_update;
  update public.reviews set state_after = p_state_after where id = p_id and state_after is null;
  alter table public.reviews enable trigger reviews_no_update;
end;
$$;
revoke execute on function public._backfill_review_state_after(uuid, public.fsrs_state) from public;
grant execute on function public._backfill_review_state_after(uuid, public.fsrs_state) to service_role;
comment on function public._backfill_review_state_after(uuid, public.fsrs_state) is
  'One-time Tier 2 backfill helper for reviews.state_after (R1 draft §1) -- opens and closes the append-only door in one call so scripts/backfill-review-state-after.ts (PostgREST, cannot toggle triggers itself) has a legal way to write. Not a general-purpose escape hatch -- drop this function once the backfill is complete everywhere it needs to run, the same way purge_user_data is the ONE standing door, not a pattern to leave lying around.';

alter table public.reviews
  alter column request_retention set not null;

comment on column public.reviews.state_after is
  'The fsrs_state resulting from this review -- makes the state_before/state_after pair symmetric with stability_before/after and difficulty_before/after. For any non-latest review, redundant with the next review''s state_before by construction (a checkable invariant, not an assumption -- see check-scheduler-cache-drift.ts Mode 3). NULLABLE FOR NOW -- see the migration''s own footer for why SET NOT NULL is deliberately not in this file.';

-- R17: learning_steps_after. No learning_steps_before -- ts-fsrs's
-- step-counting logic only ever needs the PRIOR review's resulting
-- learning_steps_after (or 0 for a card's first review) to compute the
-- next one; a _before twin would be redundant with no additional
-- checkable invariant. (9fh3zave's reasoning, confirmed.)
alter table public.reviews
  add column if not exists learning_steps_after int;

comment on column public.reviews.learning_steps_after is
  'ts-fsrs''s learning-step counter resulting from this review (R17). No learning_steps_before -- replay only ever needs the previous review''s learning_steps_after (or 0 for a first review). NULLABLE FOR NOW -- see the migration''s own footer.';

-- NEITHER COLUMN IS SET NOT NULL IN THIS FILE, DELIBERATELY -- both stay
-- nullable through the rest of this migration. Tier 2 of state_after's
-- backfill (today: all 28 existing rows -- Tier 1 above recovers none)
-- requires the scheduler, which SQL cannot call; learning_steps_after's own
-- backfill is a pure function of state_after and rating but only once
-- state_after is FULLY populated, which it isn't yet at this point in a
-- single-file apply. A `SET NOT NULL` here would fail outright (28 real
-- nulls) or worse, silently backfill learning_steps_after wrong (every row
-- reading state_after as NULL, not 'learning', so every row would compute
-- to 0 regardless of its real value). Splitting the file was the correct
-- fix, not embedding a pause a psql script has no way to honour -- see this
-- file's closing section for the follow-up migration this requires.

-- Composite target created above, in this same file (Part 0) -- not by 097,
-- which this file's questions half now supersedes. (An earlier version of
-- this comment said "097 created questions_user_id_id_key" -- a claim that
-- was never true for a genuinely clean database and, per the R24 incident,
-- was the exact false claim that broke the production apply. Corrected.)
--
-- Idempotent form throughout this section: drop-if-exists then add, so the
-- same file produces the identical end state whether these constraints
-- already exist (production's partially-applied run) or don't yet (a clean
-- database) -- per R31, one file, proven identical both ways.
alter table public.reviews drop constraint if exists reviews_question_id_fkey;
alter table public.reviews
  add constraint reviews_question_id_fkey
  foreign key (user_id, question_id) references public.questions (user_id, id)
  on delete cascade;
  -- on delete cascade, matching reviews.card_id's existing behaviour (072)
  -- for consistency within this table -- not because questions are
  -- expected to be hard-deleted in practice (095's own comment: "retired
  -- rather than deleted"). CollegeOS lead's own correction (2026-09-02):
  -- 097 already cascades questions from classes, so a RESTRICT here would
  -- make class deletion start failing on an FK the user has never heard of
  -- the moment any question in that class had one review.

alter table public.reviews drop constraint if exists reviews_item_xor;
alter table public.reviews
  add constraint reviews_item_xor
  check (num_nonnulls(card_id, question_id) = 1);

alter table public.reviews drop constraint if exists reviews_book_id_matches_card;
alter table public.reviews
  add constraint reviews_book_id_matches_card
  check ((book_id is not null) = (card_id is not null));

comment on column public.reviews.question_id is
  'XOR with card_id -- exactly one item reference per row (reviews_item_xor). Composite FK carries ownership; see 097''s header for why single-column FKs to a user-scoped parent are unsafe.';
comment on column public.reviews.correct is
  'Raw outcome for the question path, distinct from the derived 1-4 rating (R1.2/R1.3) -- cards have no equivalent column; a card''s "was it correct" is already folded into the rating by the shared (confidence, correct) -> rating function, not stored separately.';

-- Ownership-derivation trigger REWRITTEN, not merely re-confirmed. The
-- pre-existing set_review_owner_from_card looks up ONLY public.cards by
-- new.card_id and raises "card % not found" when card_id is null -- it did
-- NOT already cover question rows.
create or replace function public.set_review_owner()
returns trigger
language plpgsql
as $$
declare
  parent_book  uuid;
  parent_owner uuid;
begin
  if new.card_id is not null and new.question_id is not null then
    raise exception 'reviews: card_id and question_id are mutually exclusive';
  elsif new.card_id is not null then
    select book_id, user_id into parent_book, parent_owner
      from public.cards where id = new.card_id;
    if parent_owner is null then
      raise exception 'reviews: card % not found', new.card_id;
    end if;
  elsif new.question_id is not null then
    select user_id into parent_owner
      from public.questions where id = new.question_id;
    if parent_owner is null then
      raise exception 'reviews: question % not found', new.question_id;
    end if;
    parent_book := null;
  else
    raise exception 'reviews: exactly one of card_id or question_id must be set';
  end if;

  if auth.uid() is null then
    raise exception 'reviews: no caller session (reviews are never written on a user''s behalf)';
  end if;
  if parent_owner <> auth.uid() then
    raise exception 'reviews: item does not belong to the caller';
  end if;

  new.user_id := auth.uid();
  new.book_id := parent_book;
  return new;
end;
$$;

drop trigger if exists reviews_set_owner on public.reviews;
create trigger reviews_set_owner
  before insert on public.reviews
  for each row execute function public.set_review_owner();

-- reject_review_mutation() (append-only enforcement -- blocks UPDATE/DELETE
-- unconditionally, no role exemption) needs NO change -- read verbatim to
-- confirm: it branches on tg_op only, never touches card_id/question_id,
-- so it already covers question rows with zero modification.

-- ============================================================================
-- Part 2: card_states
-- ============================================================================

comment on table public.card_states is
  'DEMOTED 2026-09 (BOSS-RULINGS.md R1.5): a derived cache of the reviews append-only log, rebuildable by rebuildSchedulerCache(userId). Do not write here directly outside that function and submit_review''s own upsert -- check-scheduler-cache-drift.ts assumes it and will report any other writer as drift.';

-- PK problem, not present on reviews: card_states' primary key is
-- (card_id, user_id). A PRIMARY KEY disallows NULLs on every participating
-- column, so card_id cannot stay part of it once nullable for question
-- rows. Dropping the compound PK for a surrogate id, then re-establishing
-- the old uniqueness guarantee as two partial unique indexes.
-- Idempotent throughout (R31): drop-if-exists / if-not-exists everywhere,
-- so this section produces the identical end state whether run against a
-- clean database or one where it already partially or fully ran.
alter table public.card_states drop constraint if exists card_states_pkey;

alter table public.card_states
  add column if not exists id uuid default gen_random_uuid();
  -- ACCESS EXCLUSIVE table rewrite: gen_random_uuid() is volatile, so
  -- Postgres cannot use the metadata-only fast path here. Not a real
  -- locking concern at today's 376 production rows; flagged because the
  -- same file will be replayed against a much larger table once this is
  -- the platform's live scheduler.
update public.card_states set id = gen_random_uuid() where id is null;
alter table public.card_states alter column id set not null;
alter table public.card_states add constraint card_states_pkey primary key (id);

create unique index if not exists card_states_card_user_key
  on public.card_states (card_id, user_id) where card_id is not null;

alter table public.card_states
  alter column book_id drop not null;

alter table public.card_states
  add column if not exists question_id uuid;

-- Must come after question_id exists -- an earlier draft of this file had
-- this index created before the column, caught by a rolled-back dry-run
-- apply against scratch before the real attempt, not assumed correct from
-- reading the file.
create unique index if not exists card_states_question_user_key
  on public.card_states (question_id, user_id) where question_id is not null;

alter table public.card_states drop constraint if exists card_states_question_id_fkey;
alter table public.card_states
  add constraint card_states_question_id_fkey
  foreign key (user_id, question_id) references public.questions (user_id, id)
  on delete cascade;

alter table public.card_states drop constraint if exists card_states_item_xor;
alter table public.card_states
  add constraint card_states_item_xor
  check (num_nonnulls(card_id, question_id) = 1);

alter table public.card_states drop constraint if exists card_states_book_id_matches_card;
alter table public.card_states
  add constraint card_states_book_id_matches_card
  check ((book_id is not null) = (card_id is not null));

-- R17: the cache half. NOT NULL DEFAULT 0 -- unlike reviews.learning_steps_after,
-- a default is right here: a brand-new card_states row (a card's very
-- first ever grading) genuinely starts at 0, the same way reps/lapses
-- already default to 0 on this table.
alter table public.card_states
  add column if not exists learning_steps int not null default 0;

-- NO backfill UPDATE here, deliberately -- the correct value is each
-- card's latest review's learning_steps_after, but reviews.learning_steps_after
-- isn't populated yet at this point in this file (deferred to the
-- follow-up migration alongside state_after's Tier 2 backfill -- see this
-- file's closing note). `NOT NULL DEFAULT 0` above already gives every
-- EXISTING card_states row the value 0 via Postgres's own fast default-fill
-- path -- correct for every row whose real learning_steps should be 0, and
-- a placeholder for the handful that should be 1 (today: none, since Tier 1
-- backfills nothing -- see the closing note's step 2b for the correction
-- this implies once reviews.learning_steps_after is real).

comment on column public.card_states.learning_steps is
  'ts-fsrs''s learning-step counter (R17) -- read by toFsrsCard on every reconstruction, written by submit_review from reviews.learning_steps_after. Default 0 is correct for a brand-new row, not a stand-in for a value a caller forgot to supply.';

-- Trigger rewritten with the same card_id-not-null assumption removed as
-- reviews' owner trigger above, PLUS the existing dual-path logic (real
-- caller session vs. service_role-with-explicit-user_id, for the ingestion
-- worker's own writes) preserved for BOTH item kinds.
create or replace function public.card_states_derive_and_check()
returns trigger
language plpgsql
as $$
declare
  parent_book  uuid;
  parent_owner uuid;
begin
  if new.card_id is not null and new.question_id is not null then
    raise exception 'card_states: card_id and question_id are mutually exclusive';
  elsif new.card_id is not null then
    select book_id, user_id into parent_book, parent_owner
      from public.cards where id = new.card_id;
    if parent_book is null then
      raise exception 'card_states: card % not found', new.card_id;
    end if;
  elsif new.question_id is not null then
    select user_id into parent_owner
      from public.questions where id = new.question_id;
    if parent_owner is null then
      raise exception 'card_states: question % not found', new.question_id;
    end if;
    parent_book := null;
  else
    raise exception 'card_states: exactly one of card_id or question_id must be set';
  end if;

  if auth.uid() is not null then
    if parent_owner <> auth.uid() then
      raise exception 'card_states: item does not belong to the caller';
    end if;
    new.user_id := auth.uid();
  else
    if new.user_id is null or new.user_id <> parent_owner then
      raise exception
        'card_states: user_id must match the item''s owner (%) when set without a caller session',
        parent_owner;
    end if;
  end if;

  new.book_id := parent_book;
  return new;
end;
$$;

drop trigger if exists card_states_derive_and_check on public.card_states;
create trigger card_states_derive_and_check
  before insert or update of card_id, question_id on public.card_states
  for each row execute function public.card_states_derive_and_check();

-- card_states_due_queue (partial index on (user_id, due_at) where state <>
-- 'new') needs no change -- never references card_id. card_states_own_row's
-- RLS policy is generic on user_id -- needs no change either.

-- ============================================================================
-- Part 3: submit_review -- two changes from 088's body, both diffed
-- explicitly, everything else carried forward verbatim (per the standing
-- rule this migration set introduced: every redefinition names what
-- changed AND what deliberately didn't).
-- ============================================================================

-- CHANGE 1 (the lapses fix): `lapses = case when p_rating = 1 then
-- prev.lapses + 1 else prev.lapses end` becomes `... when p_rating = 1 and
-- prev.state = 'review' ...` -- matches ts-fsrs's own definition of a
-- lapse (node_modules/ts-fsrs/dist/index.umd.js:1771: `rating ===
-- Rating.Again && state === State.Review`). The old formula counted an
-- Again on a card never yet in `review` as a lapse, which FSRS does not.
-- Proven live on production: a real row shows rebuilt=0 cached=1 MISMATCH,
-- every other field matching.
--
-- CHANGE 2 (R17): learning_steps is REQUIRED in p_next_state, not
-- defaulted. LifeOS Eng 1 proposed `coalesce((p_next_state->>
-- 'learning_steps')::int, 0)`; not what's implemented -- a silent default
-- is structurally what let this field go missing for two months
-- undetected (toRpcNextState simply never included the key, nothing
-- complained). Raising means a stale client build's first grade attempt
-- fails loudly instead of silently writing a value indistinguishable from
-- a genuinely-first-step card. Stated as a disagreement, not silently
-- decided -- see the R1 draft doc §4b for the full exchange.
--
-- request_retention is SERVER-DERIVED from user_settings.desired_retention
-- for the caller, not a new RPC parameter -- see this file's header.
create or replace function public.submit_review(
  p_card_id uuid,
  p_session_id uuid,
  p_rating smallint,
  p_elapsed_ms int,
  p_answered_text text,
  p_ai_feedback text,
  p_ai_suggested_rating smallint,
  p_next_state jsonb,
  p_confidence public.confidence_level default null
)
returns public.reviews
language plpgsql
security invoker
as $$
declare
  caller uuid := auth.uid();
  prev public.card_states;
  new_reps int;
  new_stability real;
  new_difficulty real;
  new_due_at timestamptz;
  new_state public.fsrs_state;
  new_learning_steps int;
  new_request_retention real;
  inserted public.reviews;
  book_deleted boolean;
begin
  if caller is null then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("no authenticated user"). Reword only together with that file.
    raise exception 'submit_review: no authenticated user';
  end if;
  if p_rating not between 1 and 4 then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("rating must be"). Reword only together with that file.
    raise exception 'submit_review: rating must be 1..4';
  end if;

  insert into public.user_stats (user_id) values (caller) on conflict (user_id) do nothing;

  select * into prev from public.card_states
    where card_id = p_card_id and user_id = caller
    for update;

  if not found then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("no card_states row"). Reword only together with that file.
    raise exception 'submit_review: no card_states row for card % / user %', p_card_id, caller;
  end if;

  book_deleted := public.book_is_deleted(prev.book_id);
  if book_deleted then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("has been deleted"). Reword only together with that file.
    raise exception 'submit_review: book for card % has been deleted', p_card_id;
  end if;

  new_reps       := coalesce((p_next_state->>'reps')::int, prev.reps + 1);
  new_stability  := (p_next_state->>'stability')::real;
  new_difficulty := (p_next_state->>'difficulty')::real;
  new_due_at     := (p_next_state->>'due_at')::timestamptz;
  new_state      := (p_next_state->>'state')::public.fsrs_state;

  if p_next_state ? 'learning_steps' then
    new_learning_steps := (p_next_state->>'learning_steps')::int;
  else
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("learning_steps is required"). Reword only together with that file.
    raise exception 'submit_review: learning_steps is required in p_next_state';
  end if;

  select desired_retention into new_request_retention
    from public.user_settings where user_id = caller;
  if new_request_retention is null then
    -- Should be unreachable -- ensure_user_stats_settings (080) guarantees
    -- a user_settings row exists by the time a card is gradable. Fail
    -- loudly rather than silently write a null into a NOT NULL column via
    -- some other path if that guarantee is ever violated.
    raise exception 'submit_review: no user_settings row for caller % -- cannot record request_retention', caller;
  end if;

  if new_reps <> prev.reps + 1 then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("must increase by exactly"). Reword only together with that file.
    raise exception 'submit_review: reps must increase by exactly 1 (was %, proposed %)',
      prev.reps, new_reps;
  end if;
  if new_stability is null or new_stability <= 0 then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("must be > 0"). Reword only together with that file.
    raise exception 'submit_review: stability must be > 0 (proposed %)', new_stability;
  end if;
  if new_due_at is null or new_due_at <= now() then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("must be in the future"). Reword only together with that file.
    raise exception 'submit_review: due_at must be in the future (proposed %)', new_due_at;
  end if;
  if new_state is null then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("state is required"). Reword only together with that file.
    raise exception 'submit_review: state is required';
  end if;
  if prev.state = 'new' and new_state not in ('learning', 'review') then
    -- LOAD-BEARING TEXT: matched by offline-queue.ts's isPermanentFailure
    -- ("illegal transition"). Reword only together with that file.
    raise exception 'submit_review: illegal transition new -> %', new_state;
  end if;

  insert into public.reviews (
    card_id, session_id, rating, confidence, elapsed_ms, answered_text, ai_feedback,
    ai_suggested_rating, state_before, stability_before, difficulty_before,
    stability_after, difficulty_after, scheduled_days,
    state_after, learning_steps_after, request_retention
  ) values (
    p_card_id, p_session_id, p_rating, p_confidence, p_elapsed_ms, p_answered_text, p_ai_feedback,
    p_ai_suggested_rating, prev.state, prev.stability, prev.difficulty,
    new_stability, new_difficulty,
    extract(epoch from (new_due_at - now())) / 86400.0,
    new_state, new_learning_steps, new_request_retention
  ) returning * into inserted;

  update public.card_states set
    stability = new_stability,
    difficulty = new_difficulty,
    due_at = new_due_at,
    reps = new_reps,
    lapses = case when p_rating = 1 and prev.state = 'review' then prev.lapses + 1 else prev.lapses end,
    state = new_state,
    learning_steps = new_learning_steps,
    last_review_at = now(),
    last_rating = p_rating
  where card_id = p_card_id and user_id = caller;

  if p_session_id is not null then
    update public.work_sessions set cards_reviewed = coalesce(cards_reviewed, 0) + 1
      where id = p_session_id and user_id = caller;
  end if;

  update public.user_stats set total_reviews = total_reviews + 1
    where user_id = caller;

  return inserted;
end;
$$;

-- ============================================================================
-- FOLLOW-UP REQUIRED, NOT OPTIONAL POLISH: a second migration (number to be
-- allocated when this is ready, per R5) must land after this one to:
--   1. Run scripts/backfill-review-state-after.ts against the target
--      environment (requires PostgREST -- scratch has none; this repo's
--      raw-`pg` scratch verification used a throwaway runner reusing the
--      same pure planCardBackfill logic, not this script itself).
--   2. `alter table public.reviews disable trigger reviews_no_update;` then
--      `update public.reviews set learning_steps_after = case when
--      state_after = 'learning' and rating = 3 then 1 else 0 end
--      where learning_steps_after is null;` then
--      `alter table public.reviews enable trigger reviews_no_update;`
--      immediately after -- reviews is append-only (072); this migration's
--      OWN backfill UPDATEs above needed the identical bracket, discovered
--      by a failed scratch apply, not assumed. Guarded by `is null` so it
--      only touches rows step 1 didn't already cover, and is safely
--      re-runnable.
--   3. alter table public.reviews alter column state_after set not null;
--   4. alter table public.reviews alter column learning_steps_after set not null;
--   5. Correct card_states.learning_steps for any card whose real value
--      should be 1, not the 0 this migration's DEFAULT gave every existing
--      row (correct for most, a placeholder for the rest until now):
--      `update public.card_states cs set learning_steps = r.learning_steps_after
--       from (select distinct on (card_id) card_id, learning_steps_after
--             from public.reviews where card_id is not null
--             order by card_id, reviewed_at desc) r
--       where cs.card_id = r.card_id and cs.learning_steps <> r.learning_steps_after;`
--      (no trigger to disable here -- card_states is not append-only)
-- Do not run 3/4 until a query confirms zero remaining nulls on both
-- columns -- that confirmation belongs in the follow-up migration's own
-- header as evidence, not asserted from memory.
-- ============================================================================

-- ============================================================================
-- SHAPE ASSERTIONS (R31 amendment, CollegeOS lead). `if not exists` /
-- `drop constraint if exists` are OPTIMISTIC guards -- they make the
-- statement idempotent against a table/column/constraint that already
-- exists, but say nothing about whether what already exists actually has
-- the shape this migration needs. Run on a drifted database (production is
-- not cold), a guard alone can no-op past a column with the wrong type, the
-- wrong nullability, or a constraint with a different definition than the
-- one this migration intends -- a green apply over a wrong schema. This
-- block reads the catalogs directly (`information_schema.columns`,
-- `pg_constraint` via `pg_get_constraintdef`, `pg_indexes.indexdef`) and
-- RAISES, naming exactly which check failed, if reality does not match
-- intent. Placed once at the end rather than interleaved after every
-- guarded statement above -- equivalent diagnostic value (each failure
-- names its own object), avoiding fifteen-plus near-duplicate micro-blocks.
-- ============================================================================
do $$
declare
  bad text;
begin
  -- questions
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='user_id' and data_type='uuid' and is_nullable='NO') then
    raise exception 'shape assert failed: questions.user_id (expected uuid not null)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='class_id' and data_type='uuid' and is_nullable='NO') then
    raise exception 'shape assert failed: questions.class_id (expected uuid not null)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='source_skipped' and data_type='boolean' and is_nullable='NO') then
    raise exception 'shape assert failed: questions.source_skipped (expected boolean not null)';
  end if;
  select pg_get_constraintdef(oid) into bad from pg_constraint where conname='questions_class_id_fkey';
  if bad is null or bad !~ 'FOREIGN KEY \(user_id, class_id\) REFERENCES classes\(user_id, id\)' then
    raise exception 'shape assert failed: questions_class_id_fkey is not the composite (user_id,class_id)->classes(user_id,id) form (found: %)', coalesce(bad, 'MISSING');
  end if;
  if not exists (select 1 from pg_indexes where tablename='questions' and indexname='questions_user_id_id_key' and indexdef ~ 'UNIQUE.*\(user_id, id\)') then
    raise exception 'shape assert failed: questions_user_id_id_key is not a unique index on (user_id, id)';
  end if;
  if not exists (select 1 from pg_indexes where tablename='questions' and indexname='questions_user_class_active_idx') then
    raise exception 'shape assert failed: questions_user_class_active_idx missing';
  end if;
  if not exists (select 1 from pg_policies where tablename='questions' and policyname='questions_own_row') then
    raise exception 'shape assert failed: questions_own_row policy missing';
  end if;
  if not exists (select relrowsecurity from pg_class where oid='public.questions'::regclass and relrowsecurity) then
    raise exception 'shape assert failed: questions RLS not enabled';
  end if;

  -- reviews: nullability
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='reviews' and column_name='card_id' and is_nullable='NO') then
    raise exception 'shape assert failed: reviews.card_id is still NOT NULL';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='reviews' and column_name='book_id' and is_nullable='NO') then
    raise exception 'shape assert failed: reviews.book_id is still NOT NULL';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='reviews' and column_name='question_id' and data_type='uuid' and is_nullable='YES') then
    raise exception 'shape assert failed: reviews.question_id (expected nullable uuid)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='reviews' and column_name='correct' and data_type='boolean' and is_nullable='YES') then
    raise exception 'shape assert failed: reviews.correct (expected nullable boolean)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='reviews' and column_name='request_retention' and data_type='real' and is_nullable='NO') then
    raise exception 'shape assert failed: reviews.request_retention (expected real, NOT NULL -- this file sets it)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='reviews' and column_name='state_after' and is_nullable='YES') then
    raise exception 'shape assert failed: reviews.state_after (expected nullable -- deliberately, SET NOT NULL is 112''s job)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='reviews' and column_name='learning_steps_after' and data_type='integer' and is_nullable='YES') then
    raise exception 'shape assert failed: reviews.learning_steps_after (expected nullable integer)';
  end if;

  -- reviews: constraints
  select pg_get_constraintdef(oid) into bad from pg_constraint where conname='reviews_question_id_fkey' and conrelid='public.reviews'::regclass;
  if bad is null or bad !~ 'FOREIGN KEY \(user_id, question_id\) REFERENCES questions\(user_id, id\)' then
    raise exception 'shape assert failed: reviews_question_id_fkey is not the composite form (found: %)', coalesce(bad, 'MISSING');
  end if;
  select pg_get_constraintdef(oid) into bad from pg_constraint where conname='reviews_item_xor' and conrelid='public.reviews'::regclass;
  if bad is null or bad !~ 'num_nonnulls\(card_id, question_id\) = 1' then
    raise exception 'shape assert failed: reviews_item_xor missing or wrong definition (found: %)', coalesce(bad, 'MISSING');
  end if;
  select pg_get_constraintdef(oid) into bad from pg_constraint where conname='reviews_book_id_matches_card' and conrelid='public.reviews'::regclass;
  if bad is null then
    raise exception 'shape assert failed: reviews_book_id_matches_card missing';
  end if;

  -- reviews: RPC
  if not exists (select 1 from pg_proc where proname='_backfill_review_state_after') then
    raise exception 'shape assert failed: _backfill_review_state_after() missing';
  end if;

  -- card_states: PK restructure
  select pg_get_constraintdef(oid) into bad from pg_constraint where conname='card_states_pkey' and conrelid='public.card_states'::regclass;
  if bad is null or bad !~ 'PRIMARY KEY \(id\)' then
    raise exception 'shape assert failed: card_states_pkey is not PRIMARY KEY(id) (found: %)', coalesce(bad, 'MISSING');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='card_states' and column_name='id' and data_type='uuid' and is_nullable='NO') then
    raise exception 'shape assert failed: card_states.id (expected uuid not null)';
  end if;
  if not exists (select 1 from pg_indexes where tablename='card_states' and indexname='card_states_card_user_key' and indexdef ~ 'UNIQUE.*\(card_id, user_id\)' and indexdef ~ 'WHERE \(card_id IS NOT NULL\)') then
    raise exception 'shape assert failed: card_states_card_user_key is not the expected partial unique index';
  end if;
  if not exists (select 1 from pg_indexes where tablename='card_states' and indexname='card_states_question_user_key' and indexdef ~ 'UNIQUE.*\(question_id, user_id\)' and indexdef ~ 'WHERE \(question_id IS NOT NULL\)') then
    raise exception 'shape assert failed: card_states_question_user_key is not the expected partial unique index';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='card_states' and column_name='book_id' and is_nullable='NO') then
    raise exception 'shape assert failed: card_states.book_id is still NOT NULL';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='card_states' and column_name='question_id' and data_type='uuid' and is_nullable='YES') then
    raise exception 'shape assert failed: card_states.question_id (expected nullable uuid)';
  end if;
  select pg_get_constraintdef(oid) into bad from pg_constraint where conname='card_states_question_id_fkey' and conrelid='public.card_states'::regclass;
  if bad is null or bad !~ 'FOREIGN KEY \(user_id, question_id\) REFERENCES questions\(user_id, id\)' then
    raise exception 'shape assert failed: card_states_question_id_fkey is not the composite form (found: %)', coalesce(bad, 'MISSING');
  end if;
  select pg_get_constraintdef(oid) into bad from pg_constraint where conname='card_states_item_xor' and conrelid='public.card_states'::regclass;
  if bad is null or bad !~ 'num_nonnulls\(card_id, question_id\) = 1' then
    raise exception 'shape assert failed: card_states_item_xor missing or wrong definition (found: %)', coalesce(bad, 'MISSING');
  end if;
  select pg_get_constraintdef(oid) into bad from pg_constraint where conname='card_states_book_id_matches_card' and conrelid='public.card_states'::regclass;
  if bad is null then
    raise exception 'shape assert failed: card_states_book_id_matches_card missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='card_states' and column_name='learning_steps' and data_type='integer' and is_nullable='NO' and column_default = '0') then
    raise exception 'shape assert failed: card_states.learning_steps (expected integer not null default 0)';
  end if;

  raise notice 'shape assertions: all passed';
end $$;
-- ============================================================================
