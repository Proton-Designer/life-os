-- CollegeOS School merge, Phase 2 step 3b of 3: the attempt log.
--
-- This table IS the scheduler. There is no stored interval, ease, due date or lapse
-- count anywhere -- `computeSchedulerState` replays this log in order every time a
-- due queue is built. Derived state cannot drift from its source, and it needs no
-- cron whose silent failure would freeze every due date at yesterday.
--
-- It is also what makes a later move to FSRS lossless rather than a migration: with
-- no stored state there is nothing to convert, only a different replay function over
-- the same rows. The rating mapping is already agreed cross-team --
-- correct+sure -> Easy (gated on calibration), correct+thinkso -> Good,
-- correct+guessing -> Hard, wrong -> Again -- so this log is forward-compatible with
-- a scheduler that does not exist yet.
--
-- APPEND-ONLY, ENFORCED BY OMISSION.
-- There is a SELECT policy and an INSERT policy. There is deliberately NO UPDATE and
-- NO DELETE policy, and that absence IS the enforcement -- under RLS, an operation
-- with no permissive policy is denied. Adding one "just for admins" would remove
-- append-only with nothing else standing behind it. A retrieval history the user can
-- quietly edit is a history that can be made to say they knew something they didn't,
-- which defeats the one measurement this table exists to make.
--
-- WHY `local_date` IS A DATE AND NOT A TIMESTAMP.
-- Spacing intervals are counted in the user's *local* days. Deriving a day boundary
-- from a UTC instant files an 11pm session under tomorrow and shifts every interval
-- by one for anyone who studies at night -- a bug class this repo has shipped four
-- times and CollegeOS shipped three. The caller resolves the local day once, from an
-- IANA zone, and stores the result. Never compute this from `created_at`.

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,

  -- The user's local calendar day, resolved by the caller. See header.
  local_date date not null,

  -- Captured BEFORE the answer is revealed. That timing is the entire measurement:
  -- confidence after the reveal is hindsight, and hindsight is always well calibrated.
  --
  -- SPELLING IS `think_so`, WITH THE UNDERSCORE, AND IT MATTERS.
  -- CollegeOS's own database spells this `thinkso`, one word, and an earlier draft of
  -- this migration inherited that. The Self-Mastery module IN THIS REPO (not the standalone
  -- ULM project, whose Supabase project no longer resolves) owns the `confidence_level` enum
  -- -- defined in 072_ulm_reviews.sql, live on production with rows behind it -- and spells
  -- it `think_so`, which its client sends at every call site. Two spellings of the same
  -- user-facing calibration tap across two tables in one product.
  --
  -- Nothing would have errored: each value validates against its own rule. It breaks the
  -- first time anything compares calibration ACROSS domains -- "am I better calibrated on
  -- School questions than on retrieval cards" is precisely the question this merge exists
  -- to make answerable, and two spellings answer it with a silent empty set.
  --
  -- `think_so` wins because it is the more expensive one to move: it is already an enum in
  -- production with data, while this table has zero rows anywhere. Do not "restore" the
  -- CollegeOS spelling when porting its scheduler -- map at the adapter instead.
  --
  -- THIS STRING IS LOAD-BEARING, NOT COSMETIC. Self-Mastery's `mapCalibrationToGrade`
  -- switches on this literal and its default arm is a `never` exhaustiveness assertion
  -- that THROWS. A wrong spelling reaching it does not mis-grade quietly -- it raises at
  -- grade time, on the most-exercised path in the product, for anyone whose calibration
  -- value came from the School side. If you are tidying string literals, this is not one
  -- of them. `scripts/check-vocabulary-drift.sh` catches a divergence here mechanically.
  confidence text not null check (confidence in ('sure','think_so','guessing')),

  correct boolean not null,

  created_at timestamptz not null default now()
);

alter table public.attempts enable row level security;

-- Read and append. No UPDATE, no DELETE -- see header. This is not an oversight.
create policy "attempts_select_own" on public.attempts
  for select using (user_id = (select auth.uid()));

create policy "attempts_insert_own" on public.attempts
  for insert with check (user_id = (select auth.uid()));

-- The replay reads a question's whole ordered history, so the index is on the
-- grouping key plus the order it is replayed in.
create index attempts_question_date_idx
  on public.attempts (question_id, local_date);

-- Calibration (`computeCourseCalibration`) sweeps a user's 'sure' taps to find the
-- illusion-of-competence rate, so that filter gets its own partial index.
create index attempts_user_sure_idx
  on public.attempts (user_id) where confidence = 'sure';

comment on table public.attempts is
  'Append-only retrieval log. THE scheduler state -- SM-2 is replayed from these rows, never stored. No UPDATE/DELETE policy by design.';
comment on column public.attempts.local_date is
  'User-local calendar day, resolved by the caller from an IANA zone. Never derive from created_at.';
comment on column public.attempts.confidence is
  'Captured before reveal. Prospective confidence, not retrospective difficulty.';
