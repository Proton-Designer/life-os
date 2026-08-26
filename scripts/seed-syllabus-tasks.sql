-- Seed school tasks + assessments from Ayman's five Fall 2026 syllabi.
--
-- Requested 2026-08-26: "use these syllabi for each of the classes to
-- automatically add/prefill any tasks (exam dates, deadlines, and
-- assignments) that are given in the syllabi directly."
--
-- Source files (uploaded to the `syllabi` bucket by scripts/upload-syllabi.mjs):
--   CS 3345H Fall 2026 Syllabus.pdf
--   Syllabus-PHYS2326.pdf
--   F26 AMS 2341 CV SYLLABUS LONG.docx
--   MATH 2418 5 Linear Algebra - Simple Syllabus.pdf
--   Prob_Stats_Syllabus.pdf              <- contains NO dates, so seeds nothing
--
-- EVERY date below is printed in a syllabus. Nothing here is inferred,
-- interpolated, or "probably." Items a syllabus explicitly leaves open
-- (CS 3345's final exam, "date and time to be announced"; MATH 2418's four
-- online tests; AMS 2341's per-class reading questions; every CS 3341
-- deadline) are deliberately ABSENT rather than guessed — a fabricated due
-- date in a tracking app is worse than a missing one.
--
-- Idempotent: every insert is guarded on (user_id, class_id, title, due_date),
-- so re-running adds nothing. Safe to run against a database that already
-- has some of these rows.
--
--   psql "$DATABASE_URL_POOLER" -v ON_ERROR_STOP=1 -f scripts/seed-syllabus-tasks.sql

\set user_id 'f503c9b6-a0ad-4c4e-8af4-451fb065d61a'

begin;

-- psql does NOT interpolate :'user_id' inside a dollar-quoted block, so the
-- id is materialised here and read back from SQL where the do-block needs it.
create temporary table tmp_user on commit drop as select :'user_id'::uuid as user_id;

create temporary table tmp_seed (
  code        text not null,   -- classes.code
  title       text not null,
  due_date    date not null,
  task_type   text not null,   -- tasks.task_type
  assessment  text             -- null, or class_assessments.type
) on commit drop;

insert into tmp_seed (code, title, due_date, task_type, assessment) values
-- ── CS 3345.hon — Data Structures (Nemec) ────────────────────────────────
--   Theory (T) and programming (P) assignments are due Fridays 11:59 PM CT;
--   quizzes (Q) are biweekly at the start of class. Tentative schedule, p.3.
('CS-3345-HON', 'Quiz 1',                   '2026-09-03', 'quiz',                'quiz'),
('CS-3345-HON', 'Theory Assignment 1',      '2026-09-04', 'homework_assignment', null),
('CS-3345-HON', 'Programming Assignment 1', '2026-09-11', 'homework_assignment', null),
('CS-3345-HON', 'Quiz 2',                   '2026-09-17', 'quiz',                'quiz'),
('CS-3345-HON', 'Theory Assignment 2',      '2026-09-18', 'homework_assignment', null),
('CS-3345-HON', 'Theory Assignment 3',      '2026-09-25', 'homework_assignment', null),
('CS-3345-HON', 'Quiz 3',                   '2026-10-01', 'quiz',                'quiz'),
('CS-3345-HON', 'Programming Assignment 2', '2026-10-02', 'homework_assignment', null),
('CS-3345-HON', 'Theory Assignment 4',      '2026-10-09', 'homework_assignment', null),
('CS-3345-HON', 'Quiz 4',                   '2026-10-15', 'quiz',                'quiz'),
('CS-3345-HON', 'Programming Assignment 3', '2026-10-16', 'homework_assignment', null),
('CS-3345-HON', 'Theory Assignment 5',      '2026-10-23', 'homework_assignment', null),
('CS-3345-HON', 'Quiz 5',                   '2026-10-29', 'quiz',                'quiz'),
('CS-3345-HON', 'Programming Assignment 4', '2026-10-30', 'homework_assignment', null),
('CS-3345-HON', 'Theory Assignment 6',      '2026-11-06', 'homework_assignment', null),
('CS-3345-HON', 'Quiz 6',                   '2026-11-12', 'quiz',                'quiz'),
('CS-3345-HON', 'Programming Assignment 5', '2026-11-13', 'homework_assignment', null),
('CS-3345-HON', 'Theory Assignment 7',      '2026-11-20', 'homework_assignment', null),
('CS-3345-HON', 'Quiz 7',                   '2026-12-03', 'quiz',                'quiz'),
('CS-3345-HON', 'Programming Assignment 6', '2026-12-04', 'homework_assignment', null),
('CS-3345-HON', 'Theory Assignment 8',      '2026-12-09', 'homework_assignment', null),
-- Cumulative final exam: "at a date and time to be announced" (p.2). Not seeded.

-- ── PHYS 2326.002 — Electromagnetism and Waves (Liu) ─────────────────────
--   Homework due dates from the tentative schedule, §6. Exam dates from the
--   dedicated four-exam table, §7 — which is the authoritative one.
('PHYS-2326-002', 'HW1 (Mastering Physics)',  '2026-09-01', 'homework_assignment', null),
('PHYS-2326-002', 'HW2 (Mastering Physics)',  '2026-09-08', 'homework_assignment', null),
('PHYS-2326-002', 'HW3 (Mastering Physics)',  '2026-09-15', 'homework_assignment', null),
('PHYS-2326-002', 'Exam 1 (in class)',        '2026-09-22', 'exam',                'exam'),
('PHYS-2326-002', 'HW4 (Mastering Physics)',  '2026-09-29', 'homework_assignment', null),
('PHYS-2326-002', 'HW5 (Mastering Physics)',  '2026-10-06', 'homework_assignment', null),
('PHYS-2326-002', 'Exam 2 (in class)',        '2026-10-15', 'exam',                'exam'),
('PHYS-2326-002', 'HW6 (Mastering Physics)',  '2026-10-20', 'homework_assignment', null),
('PHYS-2326-002', 'HW7 (Mastering Physics)',  '2026-10-27', 'homework_assignment', null),
('PHYS-2326-002', 'HW8 (Mastering Physics)',  '2026-11-03', 'homework_assignment', null),
('PHYS-2326-002', 'Exam 3 (in class)',        '2026-11-12', 'exam',                'exam'),
('PHYS-2326-002', 'HW9 (Mastering Physics)',  '2026-11-17', 'homework_assignment', null),
('PHYS-2326-002', 'HW10 (Mastering Physics)', '2026-11-24', 'homework_assignment', null),
('PHYS-2326-002', 'HW11 (Mastering Physics)', '2026-12-01', 'homework_assignment', null),
('PHYS-2326-002', 'Exam 4 (in class)',        '2026-12-08', 'exam',                'exam'),
('PHYS-2326-002', 'HW12 (Mastering Physics)', '2026-12-08', 'homework_assignment', null),
--   Bonus-point quizzes at the UTD Testing Center (§7.iii). Optional, so they
--   are reminders rather than assignments, dated at the CLOSE of each window
--   (pretest 8/24-9/4, posttest 11/11-11/21) — the date that can be missed.
('PHYS-2326-002', 'Electromagnetism Pretest closes (extra credit, Testing Center)',  '2026-09-04', 'reminder', null),
('PHYS-2326-002', 'Electromagnetism Posttest closes (extra credit, Testing Center)', '2026-11-21', 'reminder', null),

-- ── AMS 2341.HN1 — American Studies: Crime (Smith) ───────────────────────
--   Reading questions are due before most class meetings and the top eight
--   count, so they are not enumerable as tasks; the one hard checkpoint the
--   syllabus does state ("You must hand in 4 reading questions by Tues. 13
--   Oct.") is seeded as a reminder.
('AMS-2341-HN1', 'Midterm Exam',                                    '2026-10-06', 'final_midterm', 'midterm_final'),
('AMS-2341-HN1', 'Hand in 4 reading questions by today',            '2026-10-13', 'reminder',      null),
('AMS-2341-HN1', 'Crime Narrative Paper — proposal due',            '2026-11-13', 'project_paper', null),
('AMS-2341-HN1', 'Crime Narrative Paper — peer review of drafts',   '2026-12-03', 'project_paper', null),
('AMS-2341-HN1', 'Crime Narrative Paper due (5-7 pages)',           '2026-12-06', 'project_paper', null),
('AMS-2341-HN1', 'Take-home Final Exam due (midnight)',             '2026-12-15', 'final_midterm', 'midterm_final'),

-- ── MATH 2418 — Linear Algebra, online (Nguyen, Dallas College) ──────────
--   Module deadlines are soft (1% late penalty); the introduction discussion
--   is the one hard deadline. Titles carry the covered sections so a module
--   row means something six weeks from now.
('MATH 2418', 'Introduction Discussion (hard deadline)',       '2026-09-07', 'homework_assignment', null),
('MATH 2418', 'Module 1 — sections 1.1-1.10',                  '2026-09-26', 'homework_assignment', null),
('MATH 2418', 'Module 2 — sections 2.1-2.5, 2.7, 3.1-3.3',     '2026-10-24', 'homework_assignment', null),
('MATH 2418', 'Midterm Exam (proctored)',                      '2026-10-27', 'final_midterm',       'midterm_final'),
('MATH 2418', 'Module 3 — sections 4.1-4.6, 5.1-5.3, 5.7',     '2026-11-19', 'homework_assignment', null),
('MATH 2418', 'Module 4 — sections 6.1-6.6, 7.1-7.2',          '2026-12-08', 'homework_assignment', null),
('MATH 2418', 'Final Exam (proctored)',                        '2026-12-10', 'final_midterm',       'midterm_final');
--   The syllabus also lists "Tests (online, 2 attempts each) - 4 tests in
--   total" worth 30% but gives no dates for them. Not seeded.

-- Fail loudly rather than silently seeding nothing if a code stops matching.
do $$
declare missing text;
begin
  select string_agg(distinct s.code, ', ') into missing
  from tmp_seed s
  where not exists (
    select 1 from public.classes c
    where c.user_id = (select user_id from tmp_user) and c.code = s.code
  );
  if missing is not null then
    raise exception 'No classes row matches code(s): %', missing;
  end if;
end $$;

-- MATH 2418 is the one class with no room/instructor on file — it is an
-- online Dallas College course, which is why the UTD schedule import had
-- nothing to give it. The syllabus supplies both.
update public.classes
   set instructor = coalesce(instructor, 'Minh Nguyen'),
       room       = coalesce(nullif(room, ''), 'Online')
 where user_id = :'user_id'::uuid and code = 'MATH 2418';

insert into public.tasks (user_id, domain, title, due_date, task_type, class_id)
select :'user_id'::uuid, 'school', s.title, s.due_date, s.task_type, c.id
  from tmp_seed s
  join public.classes c on c.user_id = :'user_id'::uuid and c.code = s.code
 where not exists (
   select 1 from public.tasks t
    where t.user_id = :'user_id'::uuid
      and t.class_id = c.id
      and t.title = s.title
      and t.due_date = s.due_date
 );

-- Assessments point at the task they generated (migration 048's R5 link), so
-- the class's Assessments list and both task lists stay one fact, not three.
insert into public.class_assessments (user_id, class_id, name, type, date, task_id)
select :'user_id'::uuid, c.id, s.title, s.assessment, s.due_date, t.id
  from tmp_seed s
  join public.classes c on c.user_id = :'user_id'::uuid and c.code = s.code
  join public.tasks   t on t.user_id = :'user_id'::uuid
                       and t.class_id = c.id
                       and t.title = s.title
                       and t.due_date = s.due_date
 where s.assessment is not null
   and not exists (
     select 1 from public.class_assessments a
      where a.user_id = :'user_id'::uuid
        and a.class_id = c.id
        and a.name = s.title
        and a.date = s.due_date
   );

commit;

select c.short_name, c.code,
       count(*) filter (where t.id is not null) as tasks,
       count(*) filter (where a.id is not null) as assessments,
       min(t.due_date) as first_due, max(t.due_date) as last_due
  from public.classes c
  left join public.tasks t on t.class_id = c.id
  left join public.class_assessments a on a.task_id = t.id
 where c.user_id = :'user_id'::uuid
 group by c.short_name, c.code
 order by c.code;
