-- CollegeOS School merge, Phase 2 step 2 of 3: the grade engine's inputs.
-- RENUMBERED 094 -> 106 on commit (R5). References to 093 updated to 105.
--
--
-- LifeOS captures no grade data anywhere -- no points, no weights, no categories.
-- The School module tracks *work* and has never tracked *outcomes*. So unlike 105,
-- which enriched data that already existed, this is net-new capture: nothing to
-- migrate, and nothing renders until a user enters a score. That is why it is second
-- in the order rather than first, despite being the larger user-facing win.
--
-- `weight_pct` is NOT here -- 105 added it once, on this same table, shared between
-- the risk engine and the grade engine deliberately. Same field, same meaning. Two
-- weight columns would be two numbers that must agree and eventually won't.
--
-- SHAPE: FLAT PER ASSESSMENT, NOT A CATEGORY SYSTEM.
-- CollegeOS models grades as categories (`grade_categories`, with drop-lowest-N and
-- an expected item count) containing items. That fidelity is real and it is not
-- ported here. The adapter treats each assessment as its own single-item category:
--   GradeCategory{ weightPct: weight_pct, dropLowestN: 0, expectedItemCount: 1 }
-- This computes true current/projected/required-score against the least possible
-- schema surface. What it cannot express is drop-the-lowest-quiz, which needs the
-- two-table model. Adding that later is additive -- categories would become a real
-- table and these columns would hang off items -- so nothing here forecloses it.
--
-- EXTRA CREDIT IS DELIBERATELY REPRESENTABLE.
-- There is no `points_earned <= points_possible` constraint. Scoring 105/100 is a
-- real thing that happens, and a schema that rejects it would force the user to lie
-- about a grade to store it. The grade engine handles a ratio above 1 correctly.
--
-- RLS: no new policy needed. `class_assessments` already carries RLS with an own-row
-- policy on `user_id = auth.uid()` (baseline), and a row-level policy covers every
-- column of its row including ones added later. Verified with `check-rls.sh` after
-- applying, not assumed -- the scratch environment has no `ensure_rls` trigger to
-- fall back on, so an omission there would look identical to success.

-- Nullable because "not graded yet" is the normal state of most of a semester, and
-- because the engine must be able to tell an ungraded item from a zero. A default of
-- 0 here would silently report a failing grade for every assessment not yet returned.
alter table public.class_assessments
  add column points_earned numeric(8,2) null
    check (points_earned is null or points_earned >= 0);

-- Strictly positive when present: this is a denominator. A zero here is not a valid
-- assessment worth no points, it is a division by zero waiting for the first user who
-- typos it.
alter table public.class_assessments
  add column points_possible numeric(8,2) null
    check (points_possible is null or points_possible > 0);

-- An excused item is removed from the calculation entirely rather than scored zero --
-- the distinction the whole null-is-never-zero rule exists to protect. An excused
-- midterm must not drag a grade down; it must not be there at all.
alter table public.class_assessments
  add column is_excused boolean not null default false;

-- A score with no denominator is not a grade, it is half a thought. Storing 45 with
-- no "out of" produces a row nothing can compute from and which reads as data. Require
-- both or neither -- EXCEPT when excused, where a known-weight item legitimately has
-- no earned score because the user was excused from earning one.
alter table public.class_assessments
  add constraint class_assessments_points_pair
    check (is_excused or num_nonnulls(points_earned, points_possible) <> 1);

comment on column public.class_assessments.points_earned is
  'Points scored. Null means ungraded, never zero. May exceed points_possible (extra credit).';
comment on column public.class_assessments.points_possible is
  'Denominator, strictly positive when present. Null means ungraded.';
comment on column public.class_assessments.is_excused is
  'Excused items are removed from the grade calculation, not scored zero.';
