-- 189: Canvas grade-sync + announcement-poll dedup columns (P2-21, overnight
-- run-20260915-0011, Sonnet ENG 1). Additive only.
--
-- DEDUP VIA A NULLABLE COLUMN + PARTIAL UNIQUE INDEX, not a separate
-- "seen" tracking table -- same idiom this whole run has used repeatedly
-- (habit_votes/morning_routine_checks' own unique date keys): the row a
-- successful sync would create anyway (a staging_batches row for an
-- announcement, a linked class_assessments row for a graded assignment) IS
-- the seen-marker. Re-polling a wider window than strictly necessary is
-- cheap and self-correcting (idempotent, ON CONFLICT-safe); a separate
-- cursor/seen table is one more thing that can drift from the data it's
-- describing.
--
-- GRADE-SYNC SAFETY (Opus Lead ruling, overnight run-20260915-0011, 15:59
-- CDT): "Grade sync must NEVER overwrite a grade the user entered."
-- `points_source` is the mechanism -- null (the default, and what every
-- EXISTING class_assessments row already has, since nothing writes
-- points_earned anywhere in this codebase before this migration, confirmed
-- by grep) means "not known to be Canvas-sourced" (could be a future
-- manual-entry feature's write, or simply never set); 'canvas' means "the
-- last write to points_earned was this sync." The sync code's own rule
-- (lib/canvas/sync-core.ts): write points_earned only when it is currently
-- NULL, or points_source is already 'canvas' -- never when it's non-null
-- with points_source null (a value from somewhere else, presumed
-- user-entered). A FUTURE manual-grade-entry feature must clear
-- points_source back to null on a user edit, so a later sync doesn't
-- silently reclaim and overwrite it -- noted here since nothing else
-- enforces that invariant at the database level (an application-code
-- discipline, not a constraint, same as several other "the app must
-- remember to..." notes elsewhere in this schema).
--
-- CANVAS ASSIGNMENTS WITH NO UNAMBIGUOUS LOCAL MATCH ARE NEVER
-- AUTO-CREATED (same ruling): they flow through the EXISTING staged-diff
-- confirm pipeline (migration 167, P2-07) exactly like a pasted
-- announcement -- staging_batches.source widens to admit a third value,
-- 'canvas_assignment', purely for the review UI's heading text
-- (components/school/syllabus-review-panel.tsx's own SOURCE_LABEL map);
-- the confirm/edit/reject mechanics are completely unchanged, and
-- staged_deliverables needs NO new columns at all -- createStagedDeliverablesCore
-- already accepts any ExtractedItem[], AI-produced or not.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

alter table public.class_assessments
  add column canvas_assignment_id text null,
  add column points_source text null check (points_source in ('canvas'));

comment on column public.class_assessments.canvas_assignment_id is
  'Set once this assessment is linked to a Canvas assignment (P2-21 grade sync) -- either matched unambiguously (same class, exact normalized title, or a single due-date match) or previously staged-and-confirmed from a Canvas-sourced staging_batches row. NULL means never linked -- eligible to be matched on a future sync, never auto-graded until then.';
comment on column public.class_assessments.points_source is
  'NULL (default) = not known to be Canvas-sourced (could be user-entered by a future feature, or simply never set). ''canvas'' = the last write to points_earned was P2-21''s grade sync. Grade sync overwrites points_earned only when this is NULL-with-points_earned-also-NULL or already ''canvas'' -- never a non-null points_earned with a null points_source, which is presumed user-entered and must never be silently overwritten.';

create unique index class_assessments_canvas_assignment_id_key
  on public.class_assessments (user_id, canvas_assignment_id)
  where canvas_assignment_id is not null;

comment on index public.class_assessments_canvas_assignment_id_key is
  'One local assessment per Canvas assignment per user -- the composite-FK-anchor-shaped uniqueness this run''s own idiom uses throughout, here preventing two local rows from both claiming to be the sync target for the same Canvas assignment.';

alter table public.staging_batches
  add column canvas_announcement_id text null,
  drop constraint staging_batches_source_check,
  add constraint staging_batches_source_check check (source in ('syllabus', 'announcement', 'canvas_assignment'));

comment on column public.staging_batches.canvas_announcement_id is
  'Set only for a batch created by P2-21''s Canvas announcement poller (source=''announcement''); NULL for a manually-pasted announcement or a syllabus upload. The uniqueness below is the dedup mechanism itself, not a safeguard on top of it -- re-polling the same Canvas announcement is a true INSERT...ON CONFLICT DO NOTHING no-op at the database level.';

create unique index staging_batches_canvas_announcement_id_key
  on public.staging_batches (user_id, canvas_announcement_id)
  where canvas_announcement_id is not null;

comment on index public.staging_batches_canvas_announcement_id_key is
  'One staging_batches row per Canvas announcement per user -- prevents the poller from re-staging (and re-spending an LLM extraction call on) the same announcement every run.';

do $$
declare
  v_assessments_cols int;
  v_assessments_idx boolean;
  v_batches_col boolean;
  v_batches_source_check text;
  v_batches_idx boolean;
begin
  select count(*) into v_assessments_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'class_assessments'
     and column_name in ('canvas_assignment_id', 'points_source');
  if v_assessments_cols <> 2 then
    raise exception '189: class_assessments expected 2 new columns, found %', v_assessments_cols;
  end if;

  select exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'class_assessments_canvas_assignment_id_key') into v_assessments_idx;
  if not v_assessments_idx then
    raise exception '189: class_assessments_canvas_assignment_id_key is absent';
  end if;

  select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staging_batches' and column_name = 'canvas_announcement_id') into v_batches_col;
  if not v_batches_col then
    raise exception '189: staging_batches.canvas_announcement_id is absent';
  end if;

  select pg_get_constraintdef(oid) into v_batches_source_check
    from pg_constraint where conname = 'staging_batches_source_check';
  if v_batches_source_check is null or v_batches_source_check not like '%canvas_assignment%' then
    raise exception '189: staging_batches_source_check does not admit canvas_assignment, found: %', v_batches_source_check;
  end if;

  select exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'staging_batches_canvas_announcement_id_key') into v_batches_idx;
  if not v_batches_idx then
    raise exception '189: staging_batches_canvas_announcement_id_key is absent';
  end if;

  raise notice '189 verified: class_assessments.canvas_assignment_id/points_source + unique index; staging_batches.canvas_announcement_id + widened source check + unique index';
end $$;
