-- CollegeOS School merge, Phase 2 step 1 of 3: the risk engine's inputs.
-- RENUMBERED 093 -> 105 on commit (R5: the LifeOS lead owns all migration
-- numbering). The three references to "091" in the original were stale — no
-- such migration exists — and one of them lived inside a COMMENT ON, so it
-- would have shipped INTO the database, where `\d+ classes` shows it to the
-- next reader. A comment can carry the reasoning; it must not carry a fact
-- nobody re-checks. They now point at 106, the grade-columns migration.
--
--
-- These four columns are the entire schema delta required to run CollegeOS's
-- assignment-risk engine against LifeOS's existing school data. Everything else it
-- needs -- due dates, per-class grouping, completion state -- LifeOS already
-- captures. That ratio (four nullable columns, no new tables, zero new capture UI)
-- is why the risk engine is first in the merge order rather than the grade engine,
-- which needs net-new data before it can show anything at all.
--
-- WHY EVERY COLUMN IS NULLABLE, AND WHY THAT IS NOT LAZINESS:
-- `computeAssignmentRisk` treats a missing difficulty/confidence/target as a factor
-- to EXCLUDE, renormalizing the weights of the factors that remain, rather than
-- substituting a default. A null here therefore produces an honest score computed
-- from less evidence -- not a score contaminated by an invented middle value. This
-- is the same rule the rest of this codebase applies to prayer windows and check-in
-- coverage: null is never zero, and nothing derives a verdict from silence. Adding
-- `default 3` to a rating column would quietly destroy that property for every row.
--
-- WHAT IS DELIBERATELY NOT HERE:
-- CollegeOS's `courses` table carries `term`, `color`, `professor_contact`,
-- `late_policy`, `attendance_policy` and `allowed_absences`. None are imported. No
-- feature requested them, the risk engine does not read them, and widening the
-- schema on the theory that something might want them later is how a table becomes
-- unreadable. `classes` stays the base entity and is extended in place.
--
-- ONE INPUT HAS NO SOURCE IN THIS SCHEMA, BY DESIGN:
-- `AssignmentRiskInput.committedHours` wants hours already committed to other work
-- in the window before a due date. LifeOS has no calendar-busy table, so there is
-- nothing truthful to read. The adapter passes 0 and says so at the call site --
-- "zero known commitments" is an accurate statement about absent data, whereas
-- synthesising busy-time would fabricate the exact number the engine is meant to
-- measure. Do not add a column here to satisfy it; add one when a real busy-time
-- source exists.
--
-- RLS: no policy statements needed. `classes` and `class_assessments` each already
-- carry `enable row level security` plus an own-row policy with USING and WITH
-- CHECK on `user_id = auth.uid()` (baseline lines 2467-2470). A row-level policy
-- covers every column of its row, including ones added later -- so these ALTERs
-- inherit protection rather than needing their own. This note exists because the
-- house rule is to write RLS explicitly rather than lean on the `ensure_rls` event
-- trigger; here the correct explicit action is confirming coverage, not restating
-- a policy that already applies.

-- Self-rated, 1-5, on the class rather than the assessment: difficulty and
-- understanding are properties of the subject, not of one quiz within it.
alter table public.classes
  add column difficulty_rating smallint null
    check (difficulty_rating is null or difficulty_rating between 1 and 5);

alter table public.classes
  add column confidence_rating smallint null
    check (confidence_rating is null or confidence_rating between 1 and 5);

-- Feeds the risk engine's gradeHeadroom factor, which is excluded entirely unless
-- BOTH this and a projected grade are available -- so setting it alone changes
-- nothing until 106 lands the grade columns. That is intentional: a target with no
-- projection is an aspiration, not a measurement.
alter table public.classes
  add column target_grade_pct numeric(5,2) null
    check (target_grade_pct is null or target_grade_pct between 0 and 100);

-- Share of the course grade, 0-100. Required (not optional) on AssignmentRiskInput,
-- so the adapter must supply something -- but a null here is still the right storage
-- shape, because "this assessment's weight is unknown" and "this assessment is worth
-- 0%" are different claims and only one of them is usually true. The adapter decides
-- what an unknown weight becomes; the column refuses to pretend it knows.
--
-- Shared with 106's grade engine rather than duplicated: same field, same meaning,
-- one source of truth. A second `weight_pct` on a grade-specific table would be two
-- numbers that must agree and eventually won't.
alter table public.class_assessments
  add column weight_pct numeric(5,2) null
    check (weight_pct is null or weight_pct between 0 and 100);

comment on column public.classes.difficulty_rating is
  'User''s 1-5 difficulty rating. Null excludes the difficulty factor from risk rather than defaulting it.';
comment on column public.classes.confidence_rating is
  'User''s 1-5 self-rated understanding. Null excludes the knowledge-gap factor from risk.';
comment on column public.classes.target_grade_pct is
  'Target grade 0-100. With a projection (106), enables the gradeHeadroom risk factor.';
comment on column public.class_assessments.weight_pct is
  'Share of the course grade, 0-100. Null means unknown weight, never zero weight.';
