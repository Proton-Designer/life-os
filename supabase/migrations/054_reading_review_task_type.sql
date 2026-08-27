-- Engineer B, 2026-08-26 night batch 3, item 1.
--
-- Tonight's syllabus re-extraction stored reading tasks as
-- task_type='other' + task_type_other_label='Reading' — a workaround,
-- since 050's taxonomy had no reading type. Ayman: make it official,
-- labeled "Reading/Review". Widen the constraint before the backfill so
-- the update never trips the old check. Idempotent: the backfill's WHERE
-- clause only matches rows still in the old shape, so re-running this file
-- is a no-op the second time.
--
-- Wrapped in one transaction: the drop and the re-add are two separate
-- statements, so without begin/commit there is a real interval where the
-- table has no tasks_task_type_check at all (Opus Lead correction,
-- 2026-08-27 — "no window where it was uncovered" was wrong the first time
-- this ran; nothing else happened to be writing at that moment, which is
-- not the same as being protected).
begin;

alter table public.tasks drop constraint if exists tasks_task_type_check;
alter table public.tasks add constraint tasks_task_type_check
  check (task_type in ('homework_assignment', 'quiz', 'exam', 'final_midterm', 'project_paper', 'reminder', 'reading_review', 'other'));

update public.tasks
set task_type = 'reading_review', task_type_other_label = null
where task_type = 'other' and task_type_other_label = 'Reading';

commit;
