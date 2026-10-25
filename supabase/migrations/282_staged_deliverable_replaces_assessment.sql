-- A staged deliverable that CHANGES an assessment the person already has. Written 2026-10-25, NOT yet applied.
--
-- The Canvas calendar (ICS) reconcile used to skip any assignment that was already linked or staged, so a due date that moved in Canvas was never
-- picked up. It now stages a CHANGE for the person to confirm (like an announcement's "rescheduled"), and confirming updates the existing
-- class_assessments row (and its linked task) instead of creating a second one. This column says which assessment a staged row replaces.
--
-- Composite tenancy FK (user_id, replaces_assessment_id) -> class_assessments(user_id, id), ON DELETE CASCADE: if the person deletes the
-- assessment, the pending change to it disappears with it (a change to a deleted assessment must never turn into a NEW assessment).
-- Null for every ordinary staged row. Additive. No begin;/commit; -- the runner owns the transaction.

alter table public.staged_deliverables add column if not exists replaces_assessment_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.staged_deliverables'::regclass and conname = 'staged_deliverables_replaces_assessment_same_user') then
    alter table public.staged_deliverables
      add constraint staged_deliverables_replaces_assessment_same_user
        foreign key (user_id, replaces_assessment_id) references public.class_assessments (user_id, id) on delete cascade;
  end if;
end;
$$;

create index if not exists staged_deliverables_replaces_assessment_idx
  on public.staged_deliverables (user_id, replaces_assessment_id)
  where replaces_assessment_id is not null;
