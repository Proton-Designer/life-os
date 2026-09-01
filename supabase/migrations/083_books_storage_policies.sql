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
-- Path convention: `<uid>/<book_id>.pdf` — TWO segments, flat, no per-book
-- folder. Verified against packages/core/src/books/index.ts:255
-- (`const storagePath = `${userId}/${book.id}.pdf``), not inferred.
--
-- An earlier version of this comment claimed `<uid>/<book_id>/<file>`. It was
-- wrong, and it did real damage before it was caught: the ULM lead propagated
-- that shape into their engineer's test brief, and the storage-isolation
-- checks would have thoroughly exercised a folder structure that does not
-- exist. It was caught only because that engineer was told to confirm the
-- real path with the person who wrote the upload rather than trust the doc.
-- A wrong comment in a security-policy file is worth more than a wrong comment
-- elsewhere, because this is the file people read when reasoning about the
-- convention.
--
-- The policies themselves were correct either way: they only compare
-- storage.foldername(name)[1], the uid segment, which is identical under both
-- shapes. Empirically confirmed by the ULM harness: a bare filename with no
-- separator makes foldername(name)[1] NULL, and the upload is REJECTED —
-- because in an RLS policy expression NULL denies by default. (Note that the
-- same NULL in plpgsql `IF` control flow would be falsy and fail OPEN — same
-- value, opposite outcome, decided by evaluation context.)

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
