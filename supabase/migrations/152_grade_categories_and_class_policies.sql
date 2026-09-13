-- 152: Phase 1 item #11 -- classes.term + real weight categories +
-- late-work/attendance/grade-boundary policies.
--
-- SCOPE DECISION, stated up front: migration 106's own header ruled the flat
-- per-assessment model deliberate, and closed with "adding [categories]
-- later is additive -- categories would become a real table and these
-- columns would hang off items -- so nothing here forecloses it." This file
-- is that addition, done exactly the way 106 anticipated: a new
-- `grade_categories` table, and `class_assessments` gains an OPTIONAL
-- `category_id`. Nothing existing is renamed, dropped, or repointed.
--
-- WHY THIS IS SAFE FOR THE 16 REAL CLASSES / 24 REAL ASSESSMENTS ALREADY IN
-- PRODUCTION: `category_id` is nullable and starts null on every existing
-- row (a plain ADD COLUMN, no backfill -- there is nothing to backfill INTO,
-- since no class has ever had a category to assign). A class that never
-- creates a `grade_categories` row is, and stays, byte-for-byte on the
-- original flat model: `lib/school/grades/grade-ledger.ts`'s
-- `computeClassGrade` treats an empty categoryDefs array (its new, optional
-- second parameter, defaulted to `[]`) as fully equivalent to how it always
-- behaved -- proven by every one of that file's pre-existing tests passing
-- unchanged (see this engineer's own report). The engine underneath
-- (`courseGrade.ts`) is untouched entirely: it already accepted a
-- category's `dropLowestN`/`expectedItemCount` as real, general parameters
-- -- migration 106's synthetic adapter was just always calling it with the
-- trivial `{dropLowestN: 0, expectedItemCount: 1}` values. This migration
-- and its adapter change let a real value reach the same, already-correct
-- code path for the first time.
--
-- SCOPE CUT, stated plainly rather than silently: this migration and its
-- paired TypeScript change ship the schema and a tested engine-adapter
-- capability (lib/school/grades/grade-ledger.ts's `categoryDefs` parameter).
-- They do NOT ship a grade_categories management UI (create/edit/delete a
-- category, assign an assessment to one) or a `classes.term` edit field --
-- both are real, additional frontend scope (a new dialog/panel following
-- this app's dark-first design system) deliberately left as a fast-follow
-- rather than rushed alongside this session's other tracks (#12, #20-22).
-- `late_policy`/`attendance_policy`/`allowed_absences`/`grade_boundaries`
-- are schema-only for the same reason -- present, correctly typed and
-- constrained, read/write-ready, with zero UI wired to them yet.
--
-- `classes.term` IS wired one layer deeper than the rest: `lib/school/
-- actions-core.ts`'s `updateClassCore` already accepts and forwards it
-- (compiles today against the UNTYPED SupabaseClient this file's core
-- module uses, so it needed no post-apply follow-up). What is NOT wired
-- pre-apply is the READ side (`lib/school/get-class-cards.ts`) and the
-- class-detail-dialog.tsx UI -- both are typed directly against
-- `database.types.ts` (get-class-cards.ts's own header: "the `.select(...)`
-- strings below are now checked against the real schema directly"), which
-- cannot know about a column the live database doesn't have yet. Wiring
-- those now would have meant either hand-declaring a duplicate schema type
-- (the exact anti-pattern that file's header says was fixed and must not
-- come back) or shipping code proven only to fail `tsc` until this
-- migration is applied. Once `apply-migration.sh` applies this and
-- regenerates `database.types.ts`, the remaining wire is: add `term` to
-- get-class-cards.ts's classes `.select(...)` and `ClassCardData`, and a
-- fourth `<Input>` in class-detail-dialog.tsx alongside shortName/room/
-- instructor (identical pattern, already proven safe by those three
-- fields) -- intentionally not done in the same file as this comment
-- describes it, since it cannot be proven correct before the apply.
--
-- WEIGHT CATEGORIES: drop_lowest_n / expected_item_count live on the
-- category (CollegeOS's real model), never on an assessment -- an
-- assessment's role is which category it belongs to and its own points,
-- nothing else. `weight_pct` stays required and > 0 (a category worth
-- nothing is not a category); there is deliberately NO check that a
-- class's categories sum to 100 -- categories are added one at a time, so a
-- hard constraint would make it impossible to insert the first of several.
-- The existing weightSumWarning issue the engine already emits (courseGrade.ts)
-- is the right layer for that -- non-fatal, surfaced, never a write-blocking gate.
--
-- LATE/ATTENDANCE POLICY: free text, not a structured rule engine -- no
-- feature in this codebase computes against these yet (same "additive,
-- nothing forecloses it" posture as 105's own excluded-columns list, which
-- named these same four: term, late_policy, attendance_policy,
-- allowed_absences). `allowed_absences` is the one numeric field among
-- them (a real count a future attendance feature can compare against),
-- constrained non-negative.
--
-- GRADE BOUNDARIES: `lib/school/grades/letterGrade.ts`'s `letterGradeForPct`
-- already takes an arbitrary `GradeBoundary[]` (`{letter, minPct}`) -- it has
-- had ZERO callers anywhere in this codebase (verified by grep before
-- writing this file), not because the function is wrong but because there
-- has never been anywhere to store a class's actual boundaries. This column
-- is that storage: a jsonb array, shape-checked at the database level
-- (must be a jsonb array when present), null meaning "no custom scale set"
-- rather than a fabricated default (grading scales vary by professor/
-- institution and this app does not get to invent one). A pure, tested
-- parser (`lib/school/grades/parse-grade-boundaries.ts`) turns this jsonb
-- into the `GradeBoundary[]` the existing function already consumes.
--
-- Transaction control is the runner's (apply-migration.sh, --single-
-- transaction) -- no begin/commit in this file, per ALLOCATIONS.md's rule.

-- ---------------------------------------------------------------------
-- Part 1: classes gains term + policy columns.
-- ---------------------------------------------------------------------

alter table public.classes
  add column term text null,
  add column late_policy text null,
  add column attendance_policy text null,
  add column allowed_absences smallint null,
  add column grade_boundaries jsonb null;

alter table public.classes add constraint classes_allowed_absences_check
  check (allowed_absences is null or allowed_absences >= 0);

alter table public.classes add constraint classes_grade_boundaries_is_array
  check (grade_boundaries is null or jsonb_typeof(grade_boundaries) = 'array');

comment on column public.classes.term is
  'Free text (e.g. "Fall 2026"), hand-entered like short_name/room/instructor -- no fixed academic-calendar taxonomy imposed. Null until set.';
comment on column public.classes.late_policy is
  'Free text description of this class''s late-work policy. Informational only today -- no feature computes against it yet (additive, per migration 105''s own note).';
comment on column public.classes.attendance_policy is
  'Free text description of this class''s attendance policy. Informational only today, same posture as late_policy.';
comment on column public.classes.allowed_absences is
  'A real count, non-negative when present. No feature reads it yet -- storage ahead of an attendance-tracking feature, not behind one.';
comment on column public.classes.grade_boundaries is
  'jsonb array of {letter, minPct} -- lib/school/grades/letterGrade.ts''s GradeBoundary shape. Null means no custom scale set; this app fabricates no default. Parsed by lib/school/grades/parse-grade-boundaries.ts.';

-- ---------------------------------------------------------------------
-- Part 2: grade_categories -- CollegeOS's real weight-category model.
-- ---------------------------------------------------------------------

create table public.grade_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  -- Share of the course grade, 0-100 exclusive of zero: a category worth
  -- nothing is not a category. Deliberately no cross-row CHECK that a
  -- class's categories sum to 100 -- see this file's own header.
  weight_pct numeric(5,2) not null check (weight_pct > 0 and weight_pct <= 100),
  drop_lowest_n smallint not null default 0 check (drop_lowest_n >= 0),
  expected_item_count smallint not null default 1 check (expected_item_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite tenancy FK (this program's established pattern -- 058/100/
  -- 101/140), not a plain single-column FK to classes(id): a single-column
  -- FK would let user A file a category against user B's class, since FK
  -- checks bypass RLS and only ownership captured IN the key prevents it.
  constraint grade_categories_class_same_user
    foreign key (user_id, class_id) references public.classes (user_id, id) on delete cascade
);

-- Needed as the composite-FK target for class_assessments.category_id
-- below, same role questions_user_id_id_key (111) plays for reviews/
-- card_states.question_id.
create unique index grade_categories_user_id_id_key on public.grade_categories (user_id, id);
create index grade_categories_class_id_idx on public.grade_categories (class_id);
create index grade_categories_user_id_idx on public.grade_categories (user_id);

alter table public.grade_categories enable row level security;

create policy "grade_categories_own_row"
  on public.grade_categories for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Ships with the trigger from day one (migration 141's `mcp_widgets`
-- precedent), rather than needing a future 133-style gap-fix migration for
-- a table that didn't have updated_at from the start.
create trigger grade_categories_touch_updated_at
  before update on public.grade_categories for each row execute function public.touch_updated_at();

comment on table public.grade_categories is
  'A real weight category (CollegeOS''s model): drop-lowest-N and an expected item count live here, never on an assessment. An empty category (no assessments filed under it yet) is real, unearned weight, not zero and not absent -- see lib/school/grades/grade-ledger.ts.';

-- ---------------------------------------------------------------------
-- Part 3: class_assessments.category_id -- optional link to a real category.
-- ---------------------------------------------------------------------

alter table public.class_assessments add column category_id uuid null;

alter table public.class_assessments add constraint class_assessments_category_same_user
  foreign key (user_id, category_id) references public.grade_categories (user_id, id) on delete set null (category_id);

create index class_assessments_category_id_idx on public.class_assessments (category_id) where category_id is not null;

comment on column public.class_assessments.category_id is
  'Which grade_categories row this assessment belongs to, or null. Null is the default and the ONLY value every one of the 24 assessments in production has today -- a class that never creates a category is unaffected by this column existing (lib/school/grades/grade-ledger.ts treats null and "omitted" identically). ON DELETE SET NULL, scoped to this column only (not the whole composite key) -- deleting a category un-categorizes its assessments rather than deleting them.';

-- ---------------------------------------------------------------------
-- Shape asserts -- prove what actually landed, not merely that nothing errored.
-- ---------------------------------------------------------------------
do $$
declare
  bad text;
  existing_category_rows int;
  existing_null_category_assessments int;
begin
  -- classes' new columns exist with the right nullability/type.
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='classes' and column_name='term' and data_type='text' and is_nullable='YES') then
    raise exception 'shape assert failed: classes.term missing or wrong shape';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='classes' and column_name='grade_boundaries' and data_type='jsonb' and is_nullable='YES') then
    raise exception 'shape assert failed: classes.grade_boundaries missing or wrong shape';
  end if;

  -- grade_categories: composite FK, RLS, trigger all present.
  select pg_get_constraintdef(oid) into bad from pg_constraint
   where conname = 'grade_categories_class_same_user' and conrelid = 'public.grade_categories'::regclass;
  if bad is null or bad !~ 'FOREIGN KEY \(user_id, class_id\) REFERENCES classes\(user_id, id\)' then
    raise exception 'shape assert failed: grade_categories_class_same_user is not the composite (user_id,class_id)->classes(user_id,id) form (found: %)', coalesce(bad, 'MISSING');
  end if;
  if not exists (select 1 from pg_policies where tablename='grade_categories' and policyname='grade_categories_own_row') then
    raise exception 'shape assert failed: grade_categories_own_row policy missing';
  end if;
  if not exists (select relrowsecurity from pg_class where oid='public.grade_categories'::regclass and relrowsecurity) then
    raise exception 'shape assert failed: grade_categories RLS not enabled';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'grade_categories_touch_updated_at' and tgrelid = 'public.grade_categories'::regclass) then
    raise exception 'shape assert failed: grade_categories_touch_updated_at trigger missing';
  end if;

  -- class_assessments.category_id: composite FK, ON DELETE SET NULL scoped
  -- to the one column, and -- the actual safety claim of this whole
  -- migration -- every existing row is still null.
  select pg_get_constraintdef(oid) into bad from pg_constraint
   where conname = 'class_assessments_category_same_user' and conrelid = 'public.class_assessments'::regclass;
  if bad is null or bad !~ 'FOREIGN KEY \(user_id, category_id\) REFERENCES grade_categories\(user_id, id\)' or bad !~ 'SET NULL \(category_id\)' then
    raise exception 'shape assert failed: class_assessments_category_same_user is not the expected composite/scoped-SET-NULL form (found: %)', coalesce(bad, 'MISSING');
  end if;

  select count(*) into existing_category_rows from public.grade_categories;
  if existing_category_rows <> 0 then
    raise exception 'shape assert failed: grade_categories should be empty immediately after creation, found % row(s)', existing_category_rows;
  end if;

  select count(*) into existing_null_category_assessments from public.class_assessments where category_id is not null;
  if existing_null_category_assessments <> 0 then
    raise exception 'shape assert failed: % pre-existing class_assessments row(s) unexpectedly carry a non-null category_id', existing_null_category_assessments;
  end if;

  raise notice '152 shape asserts passed: classes term/policy/boundary columns present, grade_categories real with RLS+trigger+composite FK, class_assessments.category_id present and null on all % existing rows.', (select count(*) from public.class_assessments);
end $$;
