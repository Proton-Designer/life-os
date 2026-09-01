-- Storage policies for the `books` bucket (ULM / Self-Mastery uploads).
--
-- The bucket is private. These mirror the existing `syllabi_own_folder_*`
-- policies exactly — first path segment must be the caller's own uid — so
-- there is one storage-ownership convention in this project rather than two.
--
-- WHY THIS IS A MIGRATION AND NOT A DASHBOARD CLICK: the bucket itself was
-- created via the storage API, but a bucket with no policies is unreachable to
-- every non-service role, which looks identical to "upload is broken". Policies
-- belong in version control for the same reason table policies do — D-029
-- found 19 tables whose entire RLS story existed only on the live database and
-- in nobody's repo.
--
-- Path convention, enforced here rather than trusted: <uid>/<book_id>/<file>.
-- storage.foldername(name)[1] is the first segment.

drop policy if exists "books_own_folder_select" on storage.objects;
drop policy if exists "books_own_folder_insert" on storage.objects;
drop policy if exists "books_own_folder_update" on storage.objects;
drop policy if exists "books_own_folder_delete" on storage.objects;

create policy "books_own_folder_select"
  on storage.objects for select
  using (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "books_own_folder_insert"
  on storage.objects for insert
  with check (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "books_own_folder_update"
  on storage.objects for update
  using (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "books_own_folder_delete"
  on storage.objects for delete
  using (bucket_id = 'books' and (storage.foldername(name))[1] = (select auth.uid())::text);
