-- 194: staging_batches.canvas_assignment_id (P2-21 follow-up, overnight
-- run-20260915-0011, Sonnet ENG 1). Additive only.
--
-- A SEPARATE column from migration 189's canvas_announcement_id, deliberately
-- -- not a shared/reused column for both purposes. A Canvas assignment with
-- no unambiguous local match (Opus Lead's ruling: never auto-create, stage
-- it through the P2-07 confirm pipeline instead) needs its OWN dedup marker,
-- for the exact same reason announcements need theirs: without it, a
-- still-unconfirmed staged assignment would be re-staged as a SECOND
-- duplicate batch on every subsequent poll run until the user confirms or
-- rejects it. Sharing one column between two different Canvas ID types
-- (announcement ids and assignment ids are separate Canvas object sequences)
-- would risk a cross-type collision silently blocking a legitimate stage --
-- a real, if narrow, correctness risk not worth taking to save one column.
--
-- TOMBSTONE, NOT JUST DEDUP (Opus Lead ruling, overnight run-20260915-0011,
-- 16:1x CDT): the SAME column also has to survive a REJECT, not only a
-- not-yet-confirmed pending state -- rejecting a staged Canvas assignment
-- must not let it be re-staged on the next poll either. This is true by
-- construction, not by anything new built here: rejecting a staged item
-- (staging-core.ts's own deleteStagedDeliverableCore) deletes the CHILD
-- staged_deliverables row only -- the PARENT staging_batches row (which
-- carries canvas_assignment_id) is never deleted by any existing code path
-- in this codebase (confirmed by grep: no caller anywhere issues a DELETE
-- against staging_batches itself). An all-rejected batch therefore
-- persists forever as an empty, un-confirmed row -- exactly the tombstone
-- this ruling asks for, and lib/canvas/sync-core.ts's own pre-filter query
-- reads canvas_assignment_id directly off staging_batches, never off
-- staged_deliverables, so a reject has zero effect on whether a re-poll
-- sees the marker.
--
-- Once the user confirms a Canvas-sourced staged deliverable,
-- class_assessments.canvas_assignment_id (migration 189) is NOT set by the
-- confirm step itself (addClassAssessmentCore is unchanged) -- the newly
-- created assessment gets matched and linked on the NEXT grade-sync pass
-- instead, via the same unambiguous-match logic (exact class + normalized
-- title, or a single due-date match) that links any other pre-existing
-- assessment. This keeps the confirm pipeline (migration 167) completely
-- untouched -- no new parameter threaded through addClassAssessmentCore --
-- at the cost of one extra sync cycle before a freshly-confirmed
-- Canvas-sourced assessment gets its grade filled in, an acceptable,
-- self-correcting delay (the next cron run, not never).
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

alter table public.staging_batches
  add column canvas_assignment_id text null;

comment on column public.staging_batches.canvas_assignment_id is
  'Set only for a batch created by P2-21''s Canvas grade-sync poller for an assignment with no unambiguous local match (source=''canvas_assignment''); NULL for every other batch. The uniqueness below is the dedup/tombstone mechanism -- re-polling the same unmatched Canvas assignment, whether it is still pending review OR has since been fully rejected (rejecting deletes only the child staged_deliverables row, never this one), is a true INSERT...ON CONFLICT DO NOTHING no-op, never a second duplicate batch.';

create unique index staging_batches_canvas_assignment_id_key
  on public.staging_batches (user_id, canvas_assignment_id)
  where canvas_assignment_id is not null;

comment on index public.staging_batches_canvas_assignment_id_key is
  'One staging_batches row per Canvas assignment ever staged, per user -- prevents the grade-sync poller from re-staging the same assignment whether it is still pending or was already rejected.';

do $$
declare
  v_col boolean;
  v_idx boolean;
begin
  select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staging_batches' and column_name = 'canvas_assignment_id') into v_col;
  if not v_col then
    raise exception '194: staging_batches.canvas_assignment_id is absent';
  end if;

  select exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'staging_batches_canvas_assignment_id_key') into v_idx;
  if not v_idx then
    raise exception '194: staging_batches_canvas_assignment_id_key is absent';
  end if;

  raise notice '194 verified: staging_batches.canvas_assignment_id + unique index present';
end $$;
