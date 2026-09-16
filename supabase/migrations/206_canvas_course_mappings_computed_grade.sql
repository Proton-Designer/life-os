-- 206: canvas_course_mappings computed-grade snapshot columns
-- (CANVAS-GAP-01, Team Sonnet ENG 1, allocated by Opus Lead). Builds on
-- migration 210 (canvas_course_mappings itself) and 205 (dismissed_at).
--
-- ENG3's CANVAS-VERIFY-01 live probe confirmed Canvas's own courses
-- endpoint already returns the student's own instructor-computed
-- running/final grade for free, via `include[]=total_scores` on the SAME
-- request `fetchCanvasCourses` already makes -- currently discarded
-- entirely. This app's own grade math (GradeScenarioPanel, the grade
-- ledger) independently recomputes a weighted grade from individual
-- class_assessments rows, which can legitimately drift from Canvas's own
-- number (different weighting rules, drop-lowest, extra credit, or an
-- assessment not yet synced/graded) -- showing Canvas's own number
-- alongside ours is a real value-add and a sanity check, essentially free.
--
-- A SNAPSHOT, not a live figure: computed_grade_synced_at is its own
-- dedicated timestamp, deliberately NOT reusing this row's `updated_at` --
-- `updated_at` also gets touched by a purely manual re-map
-- (setCourseMapping, migration 205's own header), which is a different
-- event from "Canvas told us this as of the last sync." Conflating the
-- two would make "as of last sync" a lie the moment someone re-maps a
-- course without a sync happening.
--
-- DISPLAY-ONLY, BY DESIGN (Opus Lead ruling): a course-level number that
-- must never interact with points_earned/points_source or the
-- canOverwriteGrade invariant on any class_assessments row, and must
-- never feed Deadline risk / Course load / Practice-vs-real, which all
-- read points_earned -- those stay exactly what they are today. This
-- migration adds no FK to class_assessments and no trigger touching it;
-- the application-code discipline (never wiring this into that math) is
-- enforced by review and a red-first test, not by the schema.
--
-- All three grade columns AND the sync timestamp are independently
-- nullable: Canvas omits a computed score/grade whenever it doesn't
-- compute one (no enrollment, a non-grading enrollment type, or a course
-- with nothing graded yet), and null here must read as "nothing to show,"
-- never a fabricated 0%/"—" the UI has to guess its way around.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

alter table public.canvas_course_mappings
  add column computed_current_score numeric null,
  add column computed_final_score numeric null,
  add column computed_current_letter_grade text null,
  add column computed_grade_synced_at timestamptz null;

comment on column public.canvas_course_mappings.computed_current_score is
  'CANVAS-GAP-01: Canvas''s own instructor-computed running grade (percent) '
  'for the current user''s enrollment, as of computed_grade_synced_at. '
  'Null when Canvas reports nothing. Display-only -- never read by '
  'Deadline risk, Course load, Practice-vs-real, or any class_assessments '
  'write path.';

comment on column public.canvas_course_mappings.computed_final_score is
  'CANVAS-GAP-01: Canvas''s own instructor-computed FINAL grade (percent, '
  'including ungraded work as zero per Canvas''s own definition), as of '
  'computed_grade_synced_at. Null when Canvas reports nothing. Same '
  'display-only posture as computed_current_score.';

comment on column public.canvas_course_mappings.computed_current_letter_grade is
  'CANVAS-GAP-01: Canvas''s own computed letter grade for the current '
  'running score, when the course uses a letter-grade scheme. Null '
  'otherwise -- never derived locally from computed_current_score.';

comment on column public.canvas_course_mappings.computed_grade_synced_at is
  'CANVAS-GAP-01: when the three computed-grade columns above were last '
  'refreshed from Canvas -- a dedicated snapshot timestamp, deliberately '
  'NOT this row''s own updated_at (which also changes on a purely manual '
  're-map, an unrelated event). Null until the first course sync that '
  'includes total_scores runs.';
