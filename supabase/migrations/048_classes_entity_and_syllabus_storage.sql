-- Engineer C, night batch 2, item 6a (Opus Lead ruling R2/R3).
--
-- A "class" today is only N rows in schedule_events sharing a
-- class_group_id (migration 046). Item 6 needs a class to own an
-- abbreviation, a syllabus file, and a list of assessments — that's an
-- entity, not a label. This migration introduces it, backfills it from the
-- existing schedule data, and sets up the first Supabase Storage bucket in
-- this project (syllabus PDFs/documents).
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Ayman's own abbreviation ("Prob & Stats", "DSA", ...) — cannot be
  -- derived from schedule data, seeded as a separate deliberate data step
  -- below. Nullable so a class added by any future flow (or a future
  -- user) that never gets a hand-picked abbreviation still renders — the
  -- card must degrade gracefully to just `code` when this is null.
  short_name text null,
  -- The course code (schedule_events.title, e.g. "CS-3341-HON") — the
  -- stable identity a class is matched on everywhere in this migration.
  code text not null,
  room text null,
  instructor text null,
  -- Object path in the `syllabi` storage bucket, e.g.
  -- "<user_id>/<class_id>/<timestamp>-syllabus.pdf" — timestamped, not a
  -- fixed name, so a swap-out's upload-then-repoint-then-delete-old
  -- sequence (class-actions.ts) can never collide with the file it's
  -- about to replace. Null until a syllabus is uploaded. Never a public
  -- URL — always resolved to a short-lived signed URL at read time.
  syllabus_path text null,
  created_at timestamptz not null default now()
);

create index classes_user_id_idx on public.classes (user_id);

alter table public.classes enable row level security;

create policy "classes_own_row"
  on public.classes for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table public.class_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  name text not null,
  type text not null check (type in ('quiz', 'exam', 'midterm_final')),
  date date not null,
  -- The task this assessment generated (Ruling R5) — set null, not
  -- cascaded, if the task is later deleted independently through the main
  -- task list: the assessment record is the durable academic fact, the
  -- task is a checklist item derived from it, so losing the checklist
  -- item shouldn't erase the record of the exam itself. The reverse
  -- (deleting the assessment deletes its task) is handled in application
  -- code (class-actions.ts's deleteClassAssessment), not a DB cascade,
  -- because it also needs to happen inside the same transaction as the
  -- assessment delete and there is no on-delete hook for "the referencing
  -- side, when the referenced row goes away" in the direction this needs.
  task_id uuid null references public.tasks(id) on delete set null,
  created_at timestamptz not null default now()
);

create index class_assessments_class_id_idx on public.class_assessments (class_id);
create index class_assessments_user_id_idx on public.class_assessments (user_id);

alter table public.class_assessments enable row level security;

create policy "class_assessments_own_row"
  on public.class_assessments for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- schedule_events.class_id: the new source of truth for "which class is
-- this occurrence part of." class_group_id (046) is deprecated in place
-- below, same pattern as cancelled_on — not dropped until verified dead.
alter table public.schedule_events
  add column class_id uuid null references public.classes(id) on delete set null;

create index schedule_events_class_id_idx on public.schedule_events (class_id) where class_id is not null;

-- Backfill, generic — NOT keyed on any specific user's course code
-- strings (Opus Lead review: hardcoding a real account's codes into a
-- migration silently does nothing for a class added later or for any
-- other user, and bakes personal data into schema history permanently).
--
-- Reuses 046's own definition of "one class": one classes row per
-- distinct class_group_id, PLUS one classes row per recurring
-- schedule_events row that has NO class_group_id (a genuine single-day
-- class, e.g. a lab that meets once a week — 046 deliberately left these
-- ungrouped rather than forcing them into a group of one). Title/location/
-- instructor are guaranteed constant within one class_group_id by 046's
-- own grouping criteria, so `distinct on` the group key is safe — no
-- collapsing of rows that actually differ.
--
-- Guarded to run at most once: skips entirely if any school schedule_events
-- row already has a class_id, so re-running this migration file (should
-- that ever happen against a branch/restored snapshot) is a no-op rather
-- than a duplicate-classes generator.
do $$
begin
  if not exists (
    select 1 from public.schedule_events where domain = 'school' and class_id is not null
  ) then
    create temporary table tmp_class_groups on commit drop as
    select distinct on (e.user_id, coalesce(e.class_group_id, e.id))
      e.user_id,
      coalesce(e.class_group_id, e.id) as group_key,
      e.title as code,
      e.location as room,
      e.instructor
    from public.schedule_events e
    where e.domain = 'school' and e.is_recurring = true
    order by e.user_id, coalesce(e.class_group_id, e.id), e.created_at asc;

    create temporary table tmp_class_ids (
      group_key uuid primary key,
      user_id uuid not null,
      class_id uuid not null default gen_random_uuid()
    ) on commit drop;

    insert into tmp_class_ids (group_key, user_id)
    select group_key, user_id from tmp_class_groups;

    insert into public.classes (id, user_id, code, room, instructor)
    select i.class_id, g.user_id, g.code, g.room, g.instructor
    from tmp_class_groups g
    join tmp_class_ids i on i.group_key = g.group_key;

    update public.schedule_events e
    set class_id = i.class_id
    from tmp_class_ids i
    where e.user_id = i.user_id
      and coalesce(e.class_group_id, e.id) = i.group_key
      and e.domain = 'school'
      and e.is_recurring = true;
  end if;
end $$;

-- short_name seeding and the MATH 2418 (Lin Alg) row are deliberately NOT
-- here (Opus Lead review, second pass): they're a data statement about one
-- specific account, not a schema rule, and belong in a hand-run data
-- operation the Lead can point at directly — same treatment as the
-- cancellation fix — not in migration history that lives forever for every
-- environment this file ever runs against. Applied by the Lead by hand
-- after this migration lands. Consequence handled in the UI: `short_name`
-- is editable from the class editor (never seed-only), and every renderer
-- falls back to `code` when it's null, so a class that never gets a
-- hand-picked abbreviation still displays correctly.
--
-- Atomic assessment deletion (Ruling R5's inverse): deleting an assessment
-- must also delete the task it generated, in the SAME transaction — a
-- partial failure must never leave the assessment gone with its task
-- orphaned in the main list, or vice versa. supabase-js has no
-- multi-statement client transaction, so this is a single Postgres
-- function (one call = one implicit transaction), the same pattern this
-- codebase already uses for save_allocation_checkin. security definer
-- because it deletes from `tasks`, which class-actions.ts's caller doesn't
-- otherwise need write access to for this one purpose; ownership is
-- enforced explicitly in the function body (not by relying on RLS being
-- bypassed), so a definer-run context is still safe.
create or replace function public.delete_class_assessment(p_assessment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id uuid;
  v_user_id uuid := auth.uid();
begin
  select task_id into v_task_id
  from public.class_assessments
  where id = p_assessment_id and user_id = v_user_id;

  if not found then
    raise exception 'assessment not found or not owned by caller';
  end if;

  delete from public.class_assessments where id = p_assessment_id and user_id = v_user_id;

  if v_task_id is not null then
    delete from public.tasks where id = v_task_id and user_id = v_user_id;
  end if;
end;
$$;

grant execute on function public.delete_class_assessment(uuid) to authenticated;

-- Deprecated 2026-08-25/26, superseded by classes.id / schedule_events.class_id
-- — same "kept, not dropped, until verified dead in prod" pattern as
-- cancelled_on (046). No reader should write or read this column after
-- this migration; B's page and this batch's class-detail wiring both
-- source from `classes` going forward (Opus Lead ruling).
comment on column public.schedule_events.class_group_id is
  'deprecated 2026-08-26, superseded by classes.id via schedule_events.class_id, safe to drop once verified in prod';

-- First Supabase Storage bucket in this project (syllabus PDFs/documents).
-- Private (public = false) — every read goes through a signed URL minted
-- server-side (class-actions.ts), never a public/anon-readable path.
-- file_size_limit and allowed_mime_types are enforced by Supabase Storage
-- itself at upload time, server-side — not just a client-side <input accept>
-- hint that a direct API call could bypass.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'syllabi',
  'syllabi',
  false,
  10485760, -- 10 MiB
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

-- Path convention enforced by these policies: "<user_id>/...", so
-- storage.foldername(name)[1] (the first path segment) must equal the
-- caller's own auth.uid(). A user can list/read/write/delete only objects
-- under their own folder — never another user's syllabus, never an
-- unscoped top-level object.
create policy "syllabi_own_folder_select"
  on storage.objects for select
  using (bucket_id = 'syllabi' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "syllabi_own_folder_insert"
  on storage.objects for insert
  with check (bucket_id = 'syllabi' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "syllabi_own_folder_update"
  on storage.objects for update
  using (bucket_id = 'syllabi' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'syllabi' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "syllabi_own_folder_delete"
  on storage.objects for delete
  using (bucket_id = 'syllabi' and (storage.foldername(name))[1] = (select auth.uid())::text);
