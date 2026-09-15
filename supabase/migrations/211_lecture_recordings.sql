-- P3-14 (Team B, tracking-app-4b) -- Lecture Capture: recording/import + storage.
--
-- Foundation table for the lecture-capture subsystem (phase-3-build-plan.md's
-- "Lecture recording/import concept" + "Audio import" items). A recording
-- belongs to exactly one class. Deliberately holds nothing about
-- transcription or question-drafting -- P3-15 attaches a `lecture_transcripts`
-- row FK'd to `lecture_recordings.id`, P3-16 drafts questions from that
-- transcript. Adding those columns here now would be speculative.
--
-- Composite tenancy FK (not a bare `class_id references classes(id)`) --
-- see 178's own header for why a single-column FK to a user-scoped parent is
-- the exact shape check-fk-tenancy.sh exists to forbid. `classes(user_id, id)`
-- is already a valid composite FK target -- reused as-is by migrations
-- 058/086/111/146/152/167.
create table public.lecture_recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid not null,
  -- Object path in the `lectures` storage bucket:
  -- "<user_id>/<class_id>/<timestamp>-<filename>" -- same convention as
  -- classes.syllabus_path (048), timestamped so re-uploads never collide.
  -- Never a public URL -- always resolved to a short-lived signed URL at
  -- read time (lecture-actions.ts).
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  -- Populated later if/when a duration probe is added; no UI or reader
  -- depends on this being non-null yet.
  duration_seconds integer null,
  -- When the lecture actually happened, distinct from `created_at` (when it
  -- was uploaded) -- null until the UI collects it; no reader depends on it.
  recorded_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint lecture_recordings_class_same_user
    foreign key (user_id, class_id) references public.classes (user_id, id) on delete cascade
);

create index lecture_recordings_class_id_idx on public.lecture_recordings (class_id);
create index lecture_recordings_user_id_idx on public.lecture_recordings (user_id);

alter table public.lecture_recordings enable row level security;

create policy "lecture_recordings_own_row"
  on public.lecture_recordings for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Private bucket -- every read goes through a signed URL minted server-side
-- (lecture-actions.ts), never a public/anon-readable path. Limit/MIME allow-
-- list enforced by Supabase Storage itself at upload time, not just a
-- client-side <input accept> hint a direct API call could bypass.
--
-- 500 MiB (vs. syllabi's 10 MiB): audio, not PDFs -- a long lecture at a
-- reasonable compressed bitrate can run into the hundreds of MB. This exact
-- number isn't specified anywhere in the source spec; logged as an
-- assumption in OPEN_QUESTIONS.md, easy to change here later.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lectures',
  'lectures',
  false,
  524288000,
  array[
    'audio/mpeg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/wav',
    'audio/webm',
    'audio/ogg'
  ]
)
on conflict (id) do nothing;

-- Path convention enforced by these policies: "<user_id>/...", so
-- storage.foldername(name)[1] (the first path segment) must equal the
-- caller's own auth.uid() -- identical shape to syllabi_own_folder_* (083),
-- one storage-ownership convention project-wide.
create policy "lectures_own_folder_select"
  on storage.objects for select
  using (bucket_id = 'lectures' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "lectures_own_folder_insert"
  on storage.objects for insert
  with check (bucket_id = 'lectures' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "lectures_own_folder_update"
  on storage.objects for update
  using (bucket_id = 'lectures' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'lectures' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "lectures_own_folder_delete"
  on storage.objects for delete
  using (bucket_id = 'lectures' and (storage.foldername(name))[1] = (select auth.uid())::text);
