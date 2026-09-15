-- P2-09, overnight run 2026-09-15, Sonnet ENG 1 (Team A).
--
-- Practice tests: assembled automatically from a class's active question
-- bank at fixed pre-exam intervals (T-14/T-7/T-3/T-1 before an exam/
-- final_midterm class_assessments row), taken via the same reveal-then-
-- self-report shape the FSRS retrieval session already uses (this app has
-- no automated free-text answer grading anywhere -- see lib/school/
-- practice-test.ts's own header for why a second grading mechanism for
-- the same `questions.answer` shape would be worse, not better).
--
-- TWO TABLES. `practice_tests` is one row per (user, exam, interval) --
-- `question_ids uuid[]` freezes the assembled set at creation time, so a
-- question added/retired to the bank AFTER assembly never silently
-- changes a test the user may have already started. `practice_test_answers`
-- is the per-question self-report, one row per (test, question) --
-- `score_pct` on the parent is computed and stored at completion time
-- from these child rows (not re-derived live on every read).
--
-- interval_label CHECK-constrained to the exact 4 fixed values (T-14/T-7/
-- T-3/T-1) -- this is a FIXED schedule, not a user-configurable one (the
-- acceptance criteria's own words), so there is no reason to admit a value
-- nothing in the app can produce.
--
-- UNIQUE (user_id, assessment_id, interval_label) IS THE ACTUAL LOCK
-- against the dispatcher assembling the same interval twice for the same
-- exam -- an INSERT that violates it (23505) means "already assembled,"
-- the same claim-via-insert-conflict shape as ai_morning_briefs (182) and
-- sleep_reminder_log (183), just via a natural key instead of a separate
-- claim table, since this row IS the content, not a lock guarding a
-- separate write.
--
-- QUESTION_IDS IS NOT A COMPOSITE FK ARRAY -- Postgres has no native FK on
-- an array column, and questions.active can change after assembly anyway
-- (see the "frozen set" reasoning above) -- so the app layer (lib/school/
-- practice-test.ts) is responsible for populating it only from that user's
-- own active questions at assembly time; RLS on `questions` already
-- prevents reading another user's rows regardless.
--
-- SELF-SERVICE RLS on both tables (full CRUD, own row) -- like
-- sleep_intents (183), this is direct gameplay data the user owns, not a
-- system log the app writes and the user only reads.
--
-- No begin;/commit; -- the runner owns the transaction.

create table public.practice_tests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id       uuid not null,
  assessment_id  uuid not null,
  interval_label text not null check (interval_label in ('T-14', 'T-7', 'T-3', 'T-1')),
  question_ids   uuid[] not null check (cardinality(question_ids) > 0),
  status         text not null default 'pending' check (status in ('pending', 'completed')),
  score_pct      numeric(5, 2) null check (score_pct is null or (score_pct >= 0 and score_pct <= 100)),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz null,
  constraint practice_tests_assessment_same_user
    foreign key (user_id, assessment_id) references public.class_assessments (user_id, id) on delete cascade,
  constraint practice_tests_class_same_user
    foreign key (user_id, class_id) references public.classes (user_id, id) on delete cascade,
  -- THE LOCK: at most one practice test per (exam, interval) per user.
  constraint practice_tests_assessment_interval_key unique (user_id, assessment_id, interval_label)
);

comment on table public.practice_tests is
  'P2-09: one auto-assembled practice test per (user, exam class_assessment, fixed pre-exam interval). question_ids freezes the assembled set at creation time -- a later change to the question bank never rewrites an already-assembled test. score_pct is computed and stored at completion from practice_test_answers, not re-derived live.';

-- Needed as the composite-FK target for practice_test_answers.practice_test_id below.
create unique index practice_tests_user_id_id_key on public.practice_tests (user_id, id);
create index practice_tests_class_id_idx on public.practice_tests (class_id);
create index practice_tests_assessment_id_idx on public.practice_tests (assessment_id);

alter table public.practice_tests enable row level security;

create policy "practice_tests_own_row"
  on public.practice_tests for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table public.practice_test_answers (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null default auth.uid() references auth.users(id) on delete cascade,
  practice_test_id       uuid not null,
  question_id            uuid not null,
  self_reported_correct  boolean not null,
  answered_at            timestamptz not null default now(),
  constraint practice_test_answers_test_same_user
    foreign key (user_id, practice_test_id) references public.practice_tests (user_id, id) on delete cascade,
  constraint practice_test_answers_question_same_user
    foreign key (user_id, question_id) references public.questions (user_id, id) on delete cascade,
  -- At most one self-report per question per test -- re-answering the same
  -- question in one sitting UPDATEs this row, never inserts a second one.
  constraint practice_test_answers_test_question_key unique (user_id, practice_test_id, question_id)
);

comment on table public.practice_test_answers is
  'P2-09: one self-reported (reveal-then-report, same shape the FSRS retrieval session already uses) answer per question per practice test. Aggregated into practice_tests.score_pct at completion time.';

create index practice_test_answers_test_id_idx on public.practice_test_answers (practice_test_id);

alter table public.practice_test_answers enable row level security;

create policy "practice_test_answers_own_row"
  on public.practice_test_answers for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

do $$
declare
  v_tests_cols int;
  v_tests_key int;
  v_tests_rls boolean;
  v_answers_cols int;
  v_answers_key int;
  v_answers_rls boolean;
begin
  select count(*) into v_tests_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'practice_tests'
     and column_name in ('id','user_id','class_id','assessment_id','interval_label','question_ids','status','score_pct','created_at','completed_at');
  if v_tests_cols <> 10 then
    raise exception '185: practice_tests expected 10 known columns, found %', v_tests_cols;
  end if;

  select count(*) into v_tests_key from pg_constraint
   where conname = 'practice_tests_assessment_interval_key' and contype = 'u';
  if v_tests_key <> 1 then
    raise exception '185: practice_tests_assessment_interval_key is absent -- the per-(exam,interval) lock is missing';
  end if;

  select relrowsecurity into v_tests_rls from pg_class where relname = 'practice_tests' and relnamespace = 'public'::regnamespace;
  if not coalesce(v_tests_rls, false) then
    raise exception '185: RLS not enabled on practice_tests';
  end if;

  select count(*) into v_answers_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'practice_test_answers'
     and column_name in ('id','user_id','practice_test_id','question_id','self_reported_correct','answered_at');
  if v_answers_cols <> 6 then
    raise exception '185: practice_test_answers expected 6 known columns, found %', v_answers_cols;
  end if;

  select count(*) into v_answers_key from pg_constraint
   where conname = 'practice_test_answers_test_question_key' and contype = 'u';
  if v_answers_key <> 1 then
    raise exception '185: practice_test_answers_test_question_key is absent';
  end if;

  select relrowsecurity into v_answers_rls from pg_class where relname = 'practice_test_answers' and relnamespace = 'public'::regnamespace;
  if not coalesce(v_answers_rls, false) then
    raise exception '185: RLS not enabled on practice_test_answers';
  end if;

  raise notice '185 verified: practice_tests (per-exam-interval lock) and practice_test_answers present, RLS self-service on both';
end $$;
