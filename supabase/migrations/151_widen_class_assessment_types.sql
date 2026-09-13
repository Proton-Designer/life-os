-- 151: widen class_assessments.type beyond quiz/exam/midterm_final (Phase 1 item
-- #12), and converge its "midterm_final" spelling with tasks.task_type's
-- "final_midterm" for the exact same concept.
--
-- CONVERGENCE DECISION (E3, 2026-09-13), not a silent rename:
-- lib/school/actions-core.ts has carried this comment since migration 048 landed:
-- "This module's own naming ('midterm_final'...) differs from tasks.task_type's
-- 'final_midterm'... same concept, independently named in two different check
-- constraints added by two different engineers the same night." The application
-- layer has been translating between the two spellings at every assessment->task
-- write (ASSESSMENT_TYPE_TO_TASK_TYPE) since that night.
--
-- scripts/check-vocabulary-drift.sh would NOT have caught this pair: its pairwise
-- heuristic requires both value sets to be the SAME SIZE before it even compares
-- them ("if length(A)!=length(B) continue"), and this pair was 3 values against 8
-- -- a same-word-different-order collision between differently-sized sets is
-- structurally below its floor, the same family of gap the script's own header
-- describes for an enum vs. a CHECK.
--
-- RESOLUTION: class_assessments.type becomes a proper SUBSET of tasks.task_type's
-- vocabulary (quiz, exam, final_midterm, homework_assignment, project_paper),
-- spelled identically to it, rather than a second closed vocabulary for the same
-- concepts. `reminder`, `reading_review` and `other` are deliberately excluded --
-- they describe to-dos that are never assessed for a grade (class_assessments is
-- the graded ledger; tasks is the general to-do list -- migration 106's own
-- distinction) -- so this is a narrower vocabulary reusing shared spelling, not
-- the same vocabulary copied. The two sets now differ in SIZE as well as content,
-- which is exactly what keeps check-vocabulary-drift.sh from ever flagging them as
-- a near-identical pair again: correct convergence looks like an exact-match
-- subset, not two same-length near-misses.
--
-- Only 2 production rows carry the old spelling (verified by direct query before
-- writing this file: type='midterm_final' count=2, 'quiz'=17, 'exam'=5, no other
-- values exist), so the data half of this migration is small and fully enumerable,
-- not a blind bulk rewrite.
--
-- ORDER MATTERS: the old CHECK does not admit 'final_midterm', so the rename
-- UPDATE must run AFTER the old CHECK is dropped and BEFORE the new one is added.
-- Reversed either way: updating before the drop is rejected by the still-live old
-- CHECK, and adding the new CHECK before the rename would fail immediately on the
-- 2 existing 'midterm_final' rows (ADD CONSTRAINT validates existing rows
-- synchronously here -- this is not NOT VALID).
--
-- Motivation for the two new values (homework_assignment, project_paper): Phase 1
-- #16's syllabus parser has nowhere to file a staged assignment or project/paper
-- deliverable today -- these are the two additions that unblock it, using
-- tasks.task_type's own spelling for both so no third vocabulary is introduced.
--
-- CROSS-BOUNDARY NOTE (flagged to the lead, not fixed here): lib/mcp/write-
-- registry.ts's ASSESSMENT_TYPES (line 239) and lib/mcp/registry.ts's assessment
-- description text (line 445) both still hardcode the pre-151 3-value vocabulary
-- and are outside this engineer's owned directories (lib/school/**,
-- components/school/**, app/(app)/school/**). Left exactly as found -- see this
-- migration's own report for the coordination ask. Applying this migration without
-- that follow-up leaves a real MCP-writer gap in both directions (an MCP write of
-- the old 'midterm_final' spelling now fails at this table's CHECK instead of at
-- the gate meant to catch it; an MCP write of 'final_midterm'/'homework_assignment'/
-- 'project_paper' is rejected by the stale gate even though this table now accepts
-- it) -- the exact "complete, tested, reviewed, deployed, and still unreachable"
-- shape migration 149's own header describes.
--
-- Transaction control is the runner's (apply-migration.sh, --single-transaction) --
-- no begin/commit in this file, per ALLOCATIONS.md's rule (111/114/115 all hit this).

alter table public.class_assessments drop constraint class_assessments_type_check;

update public.class_assessments set type = 'final_midterm' where type = 'midterm_final';

alter table public.class_assessments add constraint class_assessments_type_check
  check (type in ('quiz', 'exam', 'final_midterm', 'homework_assignment', 'project_paper'));

comment on column public.class_assessments.type is
  'Gradable deliverable type -- a subset of tasks.task_type''s vocabulary, spelled identically for the concepts they share (quiz/exam/final_midterm/homework_assignment/project_paper). reminder/reading_review/other are deliberately excluded: they are never assessed for a grade. Converged 2026-09-13 (migration 151) from this table''s own earlier ''midterm_final'' spelling -- see ALLOCATIONS.md.';

-- Shape assert: prove the rename and widen actually happened, not merely that the
-- ALTER/UPDATE statements didn't error.
do $$
declare
  bad text;
  leftover int;
begin
  select count(*) into leftover from public.class_assessments where type = 'midterm_final';
  if leftover <> 0 then
    raise exception 'shape assert failed: % row(s) still carry the old ''midterm_final'' spelling', leftover;
  end if;

  select pg_get_constraintdef(oid) into bad
    from pg_constraint
   where conname = 'class_assessments_type_check' and conrelid = 'public.class_assessments'::regclass;
  if bad is null
     or bad !~ '''quiz'''
     or bad !~ '''exam'''
     or bad !~ '''final_midterm'''
     or bad !~ '''homework_assignment'''
     or bad !~ '''project_paper'''
     or bad ~ '''midterm_final'''
  then
    raise exception 'shape assert failed: class_assessments_type_check is not the expected 5-value set (found: %)', coalesce(bad, 'MISSING');
  end if;

  raise notice '151 shape asserts passed: type widened to 5 values, old spelling gone from data and constraint.';
end $$;
