-- SCHOOL-01: "Exam" absorbs "Final/Midterm". Whether it is a Midterm or a Final is said in the NAME
-- (titles are untouched: "Midterm 1", "Final exam" keep reading as such).
--
-- Data only. The CHECK constraints are deliberately LEFT PERMISSIVE (they still admit 'final_midterm'):
-- an old client, a Canvas/syllabus extraction, or an MCP write that still sends 'final_midterm' must not
-- start failing. The app's write cores normalise final_midterm -> exam instead (lib/school/assessment-types.ts).
--
-- Today: class_assessments 2 rows, tasks 2 rows. Idempotent: re-running changes nothing.
-- staged_deliverables (unconfirmed syllabus items) are NOT rewritten here; confirm goes through
-- addClassAssessmentCore, which normalises.
-- No begin/commit: apply-migration.sh owns the transaction.

update public.class_assessments set type = 'exam' where type = 'final_midterm';
update public.tasks             set task_type = 'exam' where task_type = 'final_midterm';

-- Verification that examines real state (a check that examines nothing reports success).
do $$
declare
  v_left int;
  v_def text;
  v_checks int := 0;
begin
  select (select count(*) from public.class_assessments where type = 'final_midterm')
       + (select count(*) from public.tasks where task_type = 'final_midterm')
    into v_left;
  if v_left <> 0 then
    raise exception 'migration 257: % rows still carry final_midterm', v_left;
  end if;

  -- The CHECKs must STILL admit final_midterm (we did not tighten them).
  for v_def in
    select pg_get_constraintdef(oid) from pg_constraint
     where contype = 'c'
       and conrelid in ('public.class_assessments'::regclass, 'public.tasks'::regclass)
       and conname in ('class_assessments_type_check', 'tasks_task_type_check')
  loop
    if v_def not like '%final_midterm%' then
      raise exception 'migration 257: a type CHECK no longer admits final_midterm (must stay permissive): %', v_def;
    end if;
    v_checks := v_checks + 1;
  end loop;
  if v_checks <> 2 then
    raise exception 'migration 257: expected both type CHECKs, found %', v_checks;
  end if;
end
$$;
