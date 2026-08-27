-- Seed the per-session Reading tasks the syllabi assign but
-- scripts/seed-syllabus-tasks.sql never seeded.
--
-- Correction requested 2026-08-26/27: Ayman noticed AMS 2341's dated
-- readings ("you should complete the readings and be ready to discuss them
-- on the day they appear on the schedule") were missing from his task list,
-- and asked for all five syllabi to be re-read from scratch to check for
-- more of the same. They were re-extracted independently here (pdftotext
-- -layout / textutil, not the earlier cached extraction) and reconciled
-- against the 52 tasks / 15 assessments already in the database — every
-- existing row checked out correct against its source, nothing here
-- replaces or corrects an existing row, it only adds what was missing.
--
-- Every row below carries `task_type = 'reading_review'` (never
-- homework_assignment) — a distinct type is what makes dozens of per-class
-- readings navigable in the Task list's type filter instead of noise
-- indistinguishable from graded work. (Originally seeded as
-- `task_type = 'other'` + `task_type_other_label = 'Reading'` before
-- 054_reading_review_task_type.sql made this its own official type;
-- migration 054 backfilled the 68 rows this script had already created.)
-- Applies to the three classes whose syllabus ties a specific reading
-- to a specific date:
--   AMS 2341  — the academic calendar (dated discussion readings)
--   CS 3345   — the tentative schedule's own "Read" chapter column
--   PHYS 2326 — the tentative schedule's per-lecture "Content" chapter
-- MATH 2418 and CS 3341 have no reading-to-date mapping in their syllabi
-- (MATH 2418's schedule is module deadlines only; CS 3341's syllabus states
-- no dates anywhere) — nothing to seed for either.
--
-- Deliberately EXCLUDED (see the report accompanying this script for the
-- full reasoning, not just this list):
--   AMS 2341: Tues. 25 Aug. (orientation, no reading text), Thurs. 22 Oct.
--     and Thurs. 5 Nov. and the two Nov. 24/26 no-class days (no reading
--     text given for any of them), Tues. 1 Dec. (office hours, not reading).
--   CS 3345:  Lecture dates whose Read column is blank (Oct. 1, Oct. 8,
--     Oct. 13, Oct. 15, Dec. 8) and the two Thanksgiving no-class dates.
--   PHYS 2326: Every Review/Exam-only date (no new chapter assigned that
--     day) and the two no-class dates (Fall Break, Thanksgiving) plus the
--     final "Reading day" (no chapter listed despite the name).
--
-- Idempotent: guarded on (user_id, class_id, title, due_date), same as
-- seed-syllabus-tasks.sql. Safe to re-run.
--
--   psql "$DATABASE_URL_POOLER" -v ON_ERROR_STOP=1 -f scripts/seed-syllabus-readings.sql

\set user_id 'f503c9b6-a0ad-4c4e-8af4-451fb065d61a'

begin;

create temporary table tmp_user on commit drop as select :'user_id'::uuid as user_id;

create temporary table tmp_reading (
  code     text not null,
  title    text not null,
  due_date date not null
) on commit drop;

insert into tmp_reading (code, title, due_date) values
-- ── AMS 2341.HN1 — American Studies: Crime (Smith) ───────────────────────
--   Academic Calendar, p.2: "you should complete the readings and be ready
--   to discuss them on the day they appear on the schedule."
('AMS-2341-HN1', 'Pepper, "Crime Fiction as Unwilling Executioner" (intro)',        '2026-08-27'),
('AMS-2341-HN1', 'Halttunen, Murder Most Foul — intro + ch. 1',                     '2026-09-01'),
('AMS-2341-HN1', 'Cohen, Pillars of Salt ch. 2 + "Murder of Maria Bickford"',       '2026-09-03'),
('AMS-2341-HN1', 'Poe, "The Murders in the Rue Morgue"',                           '2026-09-08'),
('AMS-2341-HN1', 'Barrett ch. 6 + Lemire ch. 7 (Romancing the Shadow)',            '2026-09-10'),
('AMS-2341-HN1', 'Poe, "The Mystery of Marie Roget"',                              '2026-09-15'),
('AMS-2341-HN1', 'Halttunen, Murder Most Foul ch. 6 — "Murdering Medusa"',         '2026-09-17'),
('AMS-2341-HN1', 'Southworth, Hidden Hand ch. I-XVII',                             '2026-09-22'),
('AMS-2341-HN1', 'Southworth, Hidden Hand ch. XVIII-XXXI',                         '2026-09-24'),
('AMS-2341-HN1', 'Southworth, Hidden Hand ch. XXXII-XLVII',                        '2026-09-29'),
('AMS-2341-HN1', 'Southworth, Hidden Hand ch. XLVIII-LXI',                         '2026-10-01'),
('AMS-2341-HN1', 'Erin Smith, Hard-Boiled ch. 1',                                  '2026-10-08'),
('AMS-2341-HN1', 'Hammett, Red Harvest ch. 1-13',                                  '2026-10-13'),
('AMS-2341-HN1', 'Hammett, Red Harvest ch. 14-end',                                '2026-10-15'),
('AMS-2341-HN1', 'Enstad, "Ladies of Labor" ch. 2',                                '2026-10-20'),
('AMS-2341-HN1', 'Caspary, Bedelia — intro + ch. 1-5',                             '2026-10-27'),
('AMS-2341-HN1', 'Caspary, Bedelia ch. 6-end + afterword',                         '2026-10-29'),
('AMS-2341-HN1', 'Grann, Killers of the Flower Moon — The Marked Woman',           '2026-11-03'),
('AMS-2341-HN1', 'Grann, Killers of the Flower Moon — The Evidence Man',           '2026-11-10'),
('AMS-2341-HN1', 'Grann, Killers of the Flower Moon — The Reporter',               '2026-11-12'),
('AMS-2341-HN1', 'Alexander, The New Jim Crow — intro + ch. 1',                    '2026-11-17'),
('AMS-2341-HN1', 'Forman Jr., "Racial Critiques of Mass Incarceration"',           '2026-11-19'),
('AMS-2341-HN1', 'Pepper, "Crime Fiction as Unwilling Executioner" (wrap-up)',      '2026-12-08'),

-- ── CS 3345.hon — Data Structures (Nemec) ────────────────────────────────
--   Tentative schedule, p.2-3, "Read" column. Dates with a blank Read cell
--   (Oct. 1, 8, 13, 15, Dec. 8) and the two Thanksgiving dates are excluded.
('CS-3345-HON', 'Read 1.1-1.3 — Math Review',                          '2026-08-25'),
('CS-3345-HON', 'Read 2.1-2.4 — Runtime Analysis',                     '2026-08-27'),
('CS-3345-HON', 'Read 3.1-3.5 — Lists',                                '2026-09-01'),
('CS-3345-HON', 'Read 3.6-3.7 — Stacks, Queues, Deques',               '2026-09-03'),
('CS-3345-HON', 'Read 4.1-4.2, 4.8 — Maps, Dictionaries, and Trees',   '2026-09-08'),
('CS-3345-HON', 'Read 4.3 — Binary Search Trees',                      '2026-09-10'),
('CS-3345-HON', 'Read 4.4 — AVL Trees',                                '2026-09-15'),
('CS-3345-HON', 'Read 4.7 — B-Trees',                                  '2026-09-17'),
('CS-3345-HON', 'Read 12.2 — Red-Black Trees',                         '2026-09-22'),
('CS-3345-HON', 'Read 5.1-5.6 — Hashing',                              '2026-09-24'),
('CS-3345-HON', 'Read 5.7-5.9 — Universal Hashing',                    '2026-09-29'),
('CS-3345-HON', 'Read 12.4 — Tries and String Matching',               '2026-10-06'),
('CS-3345-HON', 'Read 6.1-6.3, 6.9 — Priority Queues, Binary Heaps',   '2026-10-20'),
('CS-3345-HON', 'Read 6.4, 10.1.2 — Applications of Priority Queues',  '2026-10-22'),
('CS-3345-HON', 'Read 6.8, 11.2, 11.4 — Binomial and Fibonacci Heaps', '2026-10-27'),
('CS-3345-HON', 'Read 7.1-7.6 — Basic Sorting',                        '2026-10-29'),
('CS-3345-HON', 'Read 7.7 — Quicksort',                                '2026-11-03'),
('CS-3345-HON', 'Read 7.8-7.12 — Lower Bounds and Radix Sort',         '2026-11-05'),
('CS-3345-HON', 'Read 8.1-8.5, 8.7 — Disjoint Sets and Union-Find',    '2026-11-10'),
('CS-3345-HON', 'Read 8.6 — Union-Find Analysis',                      '2026-11-12'),
('CS-3345-HON', 'Read 9.1-9.2 — Graphs and Topological Sorting',       '2026-11-17'),
('CS-3345-HON', 'Read 9.3 — Shortest Path Algorithms',                 '2026-11-19'),
('CS-3345-HON', 'Read 9.5 — Minimum Spanning Trees',                   '2026-12-01'),
('CS-3345-HON', 'Read 9.6 — Applications of Depth-First Search',       '2026-12-03'),

-- ── PHYS 2326.002 — Electromagnetism and Waves (Liu) ─────────────────────
--   Tentative schedule, §6, "Content" column. Review/Exam-only dates and
--   both no-class dates (incl. the final "Reading day," which lists no
--   chapter despite its name) are excluded.
('PHYS-2326-002', 'Read Chap 21 (Intro)',        '2026-08-25'),
('PHYS-2326-002', 'Read Chap 21',                '2026-08-27'),
('PHYS-2326-002', 'Read Chaps 21, 22',           '2026-09-01'),
('PHYS-2326-002', 'Read Chap 22',                '2026-09-03'),
('PHYS-2326-002', 'Read Chap 23',                '2026-09-08'),
('PHYS-2326-002', 'Read Chap 23',                '2026-09-10'),
('PHYS-2326-002', 'Read Chap 24',                '2026-09-17'),
('PHYS-2326-002', 'Read Chap 24',                '2026-09-24'),
('PHYS-2326-002', 'Read Chap 25',                '2026-09-29'),
('PHYS-2326-002', 'Read Chap 26',                '2026-10-01'),
('PHYS-2326-002', 'Read Chap 26',                '2026-10-06'),
('PHYS-2326-002', 'Read Chap 26',                '2026-10-08'),
('PHYS-2326-002', 'Read Chap 27',                '2026-10-20'),
('PHYS-2326-002', 'Read Chap 27',                '2026-10-22'),
('PHYS-2326-002', 'Read Chap 28',                '2026-10-27'),
('PHYS-2326-002', 'Read Chap 28',                '2026-10-29'),
('PHYS-2326-002', 'Read Chap 29',                '2026-11-03'),
('PHYS-2326-002', 'Read Chap 29',                '2026-11-05'),
('PHYS-2326-002', 'Read Chap 30',                '2026-11-17'),
('PHYS-2326-002', 'Read Chap 30',                '2026-11-19'),
('PHYS-2326-002', 'Read Chaps 31, 32',           '2026-12-01');

-- Fail loudly rather than silently seeding nothing if a code stops matching.
do $$
declare missing text;
begin
  select string_agg(distinct s.code, ', ') into missing
  from tmp_reading s
  where not exists (
    select 1 from public.classes c
    where c.user_id = (select user_id from tmp_user) and c.code = s.code
  );
  if missing is not null then
    raise exception 'No classes row matches code(s): %', missing;
  end if;
end $$;

insert into public.tasks (user_id, domain, title, due_date, task_type, class_id)
select :'user_id'::uuid, 'school', s.title, s.due_date, 'reading_review', c.id
  from tmp_reading s
  join public.classes c on c.user_id = :'user_id'::uuid and c.code = s.code
 where not exists (
   select 1 from public.tasks t
    where t.user_id = :'user_id'::uuid
      and t.class_id = c.id
      and t.title = s.title
      and t.due_date = s.due_date
 );

commit;

select c.short_name, c.code,
       count(*) filter (where t.task_type = 'reading_review') as reading_tasks_total,
       min(t.due_date) filter (where t.task_type = 'reading_review') as first_reading,
       max(t.due_date) filter (where t.task_type = 'reading_review') as last_reading
  from public.classes c
  left join public.tasks t on t.class_id = c.id and t.user_id = :'user_id'::uuid
 where c.user_id = :'user_id'::uuid
 group by c.short_name, c.code
 order by c.code;
