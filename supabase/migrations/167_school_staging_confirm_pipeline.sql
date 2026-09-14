-- 167: Phase 1 #18 -- the syllabus/announcement confirm pipeline's staging schema.
-- Prerequisite for #16 (syllabus AI extraction) and #19 ("nothing schedulable found"),
-- built first per the roadmap's own build order: #16-19 are 100% greenfield (no staged-
-- item schema existed anywhere before this), so this is not just "port 022/029's shape"
-- -- it is also the first design of what gets staged at all. Full design discussion and
-- Opus Lead ruling recorded in ALLOCATIONS.md's 167 row.
--
-- TWO TABLES. `staging_batches` is one row per upload/paste (source: syllabus PDF or
-- pasted announcement text) against one class. `staged_deliverables` is its children --
-- one row per AI-proposed assessment, each carrying its own confidence and verbatim
-- source snippet, exactly S2's "staged items ... each with confidence + source snippet"
-- spec. Rejecting a staged item is a plain DELETE of its row -- there is no separate
-- accept/reject column, since a row that survives to confirm time IS the accepted set.
--
-- WHY THE BATCH STATUS IS THREE STATES, NOT A PLAIN CAS TO 'confirmed'.
-- A pending->confirmed CAS alone is double-tap-safe (only one caller can flip it) but NOT
-- all-or-nothing: PostgREST gives no shared transaction across the CAS and the N
-- class_assessments inserts that follow it (the same limitation addClassAssessmentCore's
-- own two-statement shape already lives with), so a process dying on insert 4 of 9 would
-- leave the batch reading 'confirmed' with 5 real assessments and 4 phantom ones -- and a
-- retry does nothing, because the CAS cannot flip a second time. That is a SILENT PARTIAL
-- COMMIT, the exact failure family this repo keeps hitting (see AGENTS.md's "a mechanism
-- built, tested, and never invoked" disease -- this is that disease's sibling: a mechanism
-- invoked PARTWAY and never finished).
--
-- The fix: `pending -> confirming -> confirmed`, with per-row resumability.
-- `claim_staging_batch(p_batch_id)` CASes pending->confirming (the double-tap guard,
-- 022/029's pattern) -- but also returns the current status when the batch is ALREADY
-- `confirming` (a prior attempt that died mid-way), so a retry RESUMES rather than being
-- refused. The app then inserts only for staged rows where `committed_assessment_id IS
-- NULL` (idempotent per row, not just per batch) and stamps each success immediately.
-- `finalize_staging_batch(p_batch_id)` is the second atomic statement: it CASes
-- confirming->confirmed ONLY when `not exists (... where committed_assessment_id is
-- null)` for that batch, evaluated inside the same UPDATE's WHERE clause against one
-- consistent snapshot -- so 'confirmed' cannot be reached with an incomplete row by
-- construction, not by application discipline alone.
--
-- `date` IS NULLABLE -- #17's no-guessing rule: an ambiguous date stays unparsed rather
-- than being invented, and a staged item with no date yet is a real, expected shape (the
-- user fills it in before confirming), not an error state.
--
-- `confidence` carries a `0..1` CHECK -- a confidence score is a claim about a bounded
-- range, and an unenforced range is not something a UI can sort or threshold on with any
-- trust (Opus Lead review).
--
-- COMPOSITE TENANCY FKs ON BOTH TABLES, same as `grade_categories`/`class_assessments`
-- (152) and the other 65+ composite FKs in this program: a single-column FK would let
-- user A file a staged item against user B's batch, since FK checks bypass RLS and only
-- ownership captured IN THE KEY prevents it -- exactly what migration 150 and
-- `check-fk-tenancy.sh` exist to catch.
--
-- A ZERO-CHILD BATCH REACHING `confirmed` IS #19's "nothing schedulable found" state,
-- not an error -- `finalize_staging_batch`'s `not exists (...)` is vacuously true over
-- zero rows, so an empty batch confirms on its very first call. The UI must render this
-- as a confident success ("nothing to add"), never as a stuck or failed state.
--
-- Transaction control is the runner's (apply-migration.sh, --single-transaction) -- no
-- begin/commit in this file, per ALLOCATIONS.md's rule.

-- ---------------------------------------------------------------------
-- Part 1: staging_batches.
-- ---------------------------------------------------------------------

create table public.staging_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid not null,
  source text not null check (source in ('syllabus', 'announcement')),
  status text not null default 'pending' check (status in ('pending', 'confirming', 'confirmed')),
  created_at timestamptz not null default now(),
  constraint staging_batches_class_same_user
    foreign key (user_id, class_id) references public.classes (user_id, id) on delete cascade
);

-- Needed as the composite-FK target for staged_deliverables.batch_id below, same role
-- grade_categories_user_id_id_key (152) plays for class_assessments.category_id.
create unique index staging_batches_user_id_id_key on public.staging_batches (user_id, id);
create index staging_batches_class_id_idx on public.staging_batches (class_id);
create index staging_batches_user_id_idx on public.staging_batches (user_id);

alter table public.staging_batches enable row level security;

create policy "staging_batches_own_row"
  on public.staging_batches for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table public.staging_batches is
  '167/Phase 1 #18: one row per syllabus upload or announcement paste against one class. status: pending (staged, not yet confirmed) -> confirming (claimed by claim_staging_batch, commit in progress or resumable) -> confirmed (finalize_staging_batch verified every child row has a committed_assessment_id). Never regresses.';

-- ---------------------------------------------------------------------
-- Part 2: staged_deliverables -- one row per AI-proposed assessment.
-- ---------------------------------------------------------------------

-- Needed as the composite-FK target for class_assessments.id below -- class_assessments
-- had no (user_id, id) unique index before this (only its plain id primary key).
create unique index class_assessments_user_id_id_key on public.class_assessments (user_id, id);

create table public.staged_deliverables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  batch_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  -- Same vocabulary as class_assessments.type (migration 151) -- a staged item that will
  -- become a class_assessments row must already speak that row's own spelling, not a
  -- second vocabulary translated at confirm time.
  type text not null check (type in ('quiz', 'exam', 'final_midterm', 'homework_assignment', 'project_paper')),
  -- Nullable -- #17's no-guessing rule. Null means "the parser could not resolve this
  -- date with confidence," a real, expected, user-fills-it-in-before-confirming state.
  date date null,
  confidence numeric(3, 2) not null check (confidence >= 0 and confidence <= 1),
  source_snippet text null,
  -- Null until this row's confirm-time insert into class_assessments succeeds. Makes the
  -- batch-level commit resumable and idempotent PER ROW -- see this file's own header.
  committed_assessment_id uuid null,
  created_at timestamptz not null default now(),
  constraint staged_deliverables_batch_same_user
    foreign key (user_id, batch_id) references public.staging_batches (user_id, id) on delete cascade,
  constraint staged_deliverables_committed_assessment_same_user
    foreign key (user_id, committed_assessment_id) references public.class_assessments (user_id, id) on delete set null (committed_assessment_id)
);

create index staged_deliverables_batch_id_idx on public.staged_deliverables (batch_id);
create index staged_deliverables_user_id_idx on public.staged_deliverables (user_id);
-- The predicate the resume/finalize path filters and checks existence on constantly.
create index staged_deliverables_uncommitted_idx on public.staged_deliverables (batch_id) where committed_assessment_id is null;

alter table public.staged_deliverables enable row level security;

create policy "staged_deliverables_own_row"
  on public.staged_deliverables for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table public.staged_deliverables is
  '167/Phase 1 #18: one AI-proposed assessment awaiting confirm. Rejecting one is a plain DELETE -- a row that survives to confirm time IS the accepted set, no separate accept/reject column. committed_assessment_id is set exactly once, by the confirm insert loop, and never cleared except via class_assessments deletion cascading through its own FK (ON DELETE SET NULL, scoped to this column only).';

-- ---------------------------------------------------------------------
-- Part 3: the confirm pipeline's two atomic RPCs.
-- ---------------------------------------------------------------------

-- Claims a batch for confirming, or reports its current state so a retry can resume
-- rather than being silently refused. Returns the batch's status after the call:
--   'confirming' -- freshly claimed (first call) or already in progress (a resume)
--   'confirmed'  -- already fully committed, nothing left to do
--   null         -- no such batch for this user
create or replace function public.claim_staging_batch(p_batch_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
begin
  update public.staging_batches
    set status = 'confirming'
    where id = p_batch_id and user_id = auth.uid() and status = 'pending'
    returning status into v_status;

  if v_status is not null then
    return v_status;
  end if;

  select status into v_status
    from public.staging_batches
    where id = p_batch_id and user_id = auth.uid();

  return v_status;
end;
$$;

grant execute on function public.claim_staging_batch(uuid) to authenticated;

comment on function public.claim_staging_batch(uuid) is
  '167/Phase 1 #18: the double-tap guard (022/029''s CAS pattern), adapted so a resume on an already-''confirming'' batch is a legal, expected call, not a refusal. The app is expected to follow a ''confirming'' or freshly-claimed result by inserting class_assessments for every staged_deliverables row with committed_assessment_id IS NULL, then call finalize_staging_batch.';

-- Flips confirming->confirmed ONLY when every child row has a committed_assessment_id --
-- evaluated inside this one UPDATE's WHERE clause against a single consistent snapshot,
-- so 'confirmed' cannot be reached with an incomplete row by construction. Returns
-- whether it actually flipped (false means: not yet complete, or already confirmed, or
-- no such batch -- the app distinguishes those by re-reading status if it needs to).
create or replace function public.finalize_staging_batch(p_batch_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rows_updated int;
begin
  update public.staging_batches
    set status = 'confirmed'
    where id = p_batch_id
      and user_id = auth.uid()
      and status = 'confirming'
      and not exists (
        select 1 from public.staged_deliverables
        where batch_id = p_batch_id and committed_assessment_id is null
      );
  get diagnostics v_rows_updated = row_count;
  return v_rows_updated > 0;
end;
$$;

grant execute on function public.finalize_staging_batch(uuid) to authenticated;

comment on function public.finalize_staging_batch(uuid) is
  '167/Phase 1 #18: the all-or-nothing guarantee. A zero-child batch confirms on its first call (the NOT EXISTS is vacuously true) -- #19''s "nothing schedulable found" success state, not an error.';

-- ---------------------------------------------------------------------
-- Shape asserts -- prove what actually landed, not merely that nothing errored.
-- ---------------------------------------------------------------------
do $$
declare
  bad text;
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'staging_batches') then
    raise exception 'shape assert failed: staging_batches missing';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'staged_deliverables') then
    raise exception 'shape assert failed: staged_deliverables missing';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staged_deliverables' and column_name = 'date' and is_nullable = 'YES') then
    raise exception 'shape assert failed: staged_deliverables.date must be nullable (#17 no-guessing rule)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staged_deliverables' and column_name = 'committed_assessment_id' and is_nullable = 'YES') then
    raise exception 'shape assert failed: staged_deliverables.committed_assessment_id must be nullable';
  end if;

  select pg_get_constraintdef(oid) into bad from pg_constraint
   where conname = 'staging_batches_class_same_user' and conrelid = 'public.staging_batches'::regclass;
  if bad is null or bad !~ 'FOREIGN KEY \(user_id, class_id\) REFERENCES classes\(user_id, id\)' then
    raise exception 'shape assert failed: staging_batches_class_same_user is not the composite (user_id,class_id)->classes(user_id,id) form (found: %)', coalesce(bad, 'MISSING');
  end if;

  select pg_get_constraintdef(oid) into bad from pg_constraint
   where conname = 'staged_deliverables_batch_same_user' and conrelid = 'public.staged_deliverables'::regclass;
  if bad is null or bad !~ 'FOREIGN KEY \(user_id, batch_id\) REFERENCES staging_batches\(user_id, id\)' then
    raise exception 'shape assert failed: staged_deliverables_batch_same_user is not the composite (user_id,batch_id)->staging_batches(user_id,id) form (found: %)', coalesce(bad, 'MISSING');
  end if;

  select pg_get_constraintdef(oid) into bad from pg_constraint
   where conname = 'staged_deliverables_committed_assessment_same_user' and conrelid = 'public.staged_deliverables'::regclass;
  if bad is null or bad !~ 'FOREIGN KEY \(user_id, committed_assessment_id\) REFERENCES class_assessments\(user_id, id\)' or bad !~ 'SET NULL \(committed_assessment_id\)' then
    raise exception 'shape assert failed: staged_deliverables_committed_assessment_same_user is not the expected composite/scoped-SET-NULL form (found: %)', coalesce(bad, 'MISSING');
  end if;

  if not exists (select 1 from pg_policies where tablename = 'staging_batches' and policyname = 'staging_batches_own_row') then
    raise exception 'shape assert failed: staging_batches_own_row policy missing';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'staged_deliverables' and policyname = 'staged_deliverables_own_row') then
    raise exception 'shape assert failed: staged_deliverables_own_row policy missing';
  end if;
  if not exists (select relrowsecurity from pg_class where oid = 'public.staging_batches'::regclass and relrowsecurity) then
    raise exception 'shape assert failed: staging_batches RLS not enabled';
  end if;
  if not exists (select relrowsecurity from pg_class where oid = 'public.staged_deliverables'::regclass and relrowsecurity) then
    raise exception 'shape assert failed: staged_deliverables RLS not enabled';
  end if;

  if not exists (select 1 from pg_proc where proname = 'claim_staging_batch') then
    raise exception 'shape assert failed: claim_staging_batch function missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'finalize_staging_batch') then
    raise exception 'shape assert failed: finalize_staging_batch function missing';
  end if;

  raise notice '167 shape asserts passed: staging_batches + staged_deliverables real with RLS+composite FKs, claim_staging_batch + finalize_staging_batch present.';
end $$;
