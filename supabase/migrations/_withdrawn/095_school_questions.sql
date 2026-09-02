-- CollegeOS School merge, Phase 2 step 3a of 3: the question bank.
--
-- Unlike 093 and 094, which extended tables LifeOS already had, this is a genuinely
-- new surface: LifeOS has no question bank, no drill, and no retrieval practice of
-- any kind. That is why it is last in the merge order despite carrying the highest
-- raw value -- there is no existing screen to enhance, so it needs UI before it
-- shows anything.
--
-- RLS IS WRITTEN EXPLICITLY HERE, NOT INHERITED.
-- The `ensure_rls` event trigger cannot install in the scratch environment (event
-- triggers require superuser, and Supabase's `postgres` role deliberately is not
-- one), so a new table created without a policy is genuinely unprotected there and
-- looks identical to a protected one. Policy ships in the same migration as the
-- table, never a follow-up: a window where the table exists without its policy is a
-- window where the app is broken and nothing reports which migration caused it.
--
-- NO SCHEDULER STATE COLUMNS, DELIBERATELY.
-- There is no `interval_days`, `ease`, `due_date` or `lapses` here. Scheduler state is
-- replayed from the append-only review log, never stored on the item. Derived state
-- cannot drift from its log, and it needs no cron whose silent failure would freeze
-- every due date at yesterday.
--
-- THE LOG IS `public.reviews`, NOT A SECOND ONE (ruling R1.2, 2026-09-02).
-- An earlier draft of this merge shipped its own `attempts` table beside ULM's
-- `reviews`, which would have given one product two append-only retrieval logs. That
-- draft is withdrawn and kept as rationale at `_withdrawn/096_school_attempts.sql`.
-- `reviews` carries an XOR item reference -- exactly one of `card_id` / `question_id`
-- -- so a question's history and a book card's history live in the same table, graded
-- by the same `(confidence, correct) -> rating` function, scheduled by the same FSRS.
--
-- That is not tidiness. "Am I better calibrated on class questions than on book cards"
-- is the cross-domain question this merge exists to make answerable, and two logs
-- answer it with a silent empty set.

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,

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
    check (source_skipped or (source_anchor is not null and length(btrim(source_anchor)) > 0))
);

alter table public.questions enable row level security;

create policy "questions_own_row" on public.questions
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- The queue reads active questions for a user's classes, ordered by what is due --
-- which is derived, so the index that matters is the one narrowing to the candidate
-- set before replay happens.
create index questions_user_class_active_idx
  on public.questions (user_id, class_id) where active;

comment on table public.questions is
  'Retrieval-practice questions, one per class. Scheduler state is NOT stored here -- it is replayed from public.reviews (R1.2).';
comment on column public.questions.source_anchor is
  'Where in the source this came from. Required unless source_skipped is true.';
comment on column public.questions.active is
  'Retired questions stay for review history. Never hard-delete a practised question.';
