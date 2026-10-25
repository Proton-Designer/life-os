-- Retry a failed book from the library ("Try again"). Written 2026-10-25, NOT yet applied: Opus Lead reviews and applies.
--
-- A book can fail for a reason that is not its file (the AI provider timed out, a spend cap, our own bug), and the client
-- has no way to put it back in the queue: claim_/advance_/skip_ingestion_* are service-role only (172), and ingestion_jobs
-- has no client write policy. This is the one narrow door: the signed-in OWNER of a FAILED book puts it back at 'queued'.
--
-- SECURITY DEFINER with auth.uid() checked inside (no service-role key in the Server Action). It touches only that
-- user's own book + job. It does NOT decide whether a failure is worth retrying (a scanned or password-protected PDF will
-- fail the same way); the action checks that from the book's error_message (isRetryableBookError) before calling.
--
-- Returns: 'retried' | 'not_found' | 'not_failed' | 'file_gone'. Idempotent: a second call finds the book already
-- 'processing' and returns 'not_failed' without touching anything.
-- No begin;/commit; -- the runner owns the transaction.

create or replace function public.retry_book_ingestion(p_book_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_status public.book_status;
  v_file_path text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Lock the row so two taps can't both reset it.
  select b.status, b.file_path into v_status, v_file_path
    from public.books b
   where b.id = p_book_id and b.user_id = v_uid
   for update;
  if not found then
    return 'not_found';
  end if;
  if v_status <> 'failed' then
    return 'not_failed';
  end if;
  -- The PDF is only kept until a book finishes; without it there is nothing to run again.
  if v_file_path is null
     or not exists (select 1 from storage.objects o where o.bucket_id = 'books' and o.name = v_file_path) then
    return 'file_gone';
  end if;

  update public.ingestion_jobs
     set stage = 'queued',
         cursor_chunk_index = null,
         cursor_attempt = 0,
         skipped_positions = 0,
         consecutive_skipped_positions = 0,
         leased_until = null,
         last_error = null
   where book_id = p_book_id and user_id = v_uid;
  if not found then
    -- A book the sweep failed for having no job at all: make one (user_id is also set by the table's trigger).
    insert into public.ingestion_jobs (book_id, user_id, stage) values (p_book_id, v_uid, 'queued');
  end if;

  update public.books
     set status = 'processing', stage = 'queued', progress_pct = 0, error_message = null
   where id = p_book_id and user_id = v_uid;

  return 'retried';
end;
$$;

revoke execute on function public.retry_book_ingestion(uuid) from public, anon;
grant execute on function public.retry_book_ingestion(uuid) to authenticated, service_role;

comment on function public.retry_book_ingestion(uuid) is
  'Owner-only: puts a FAILED book (whose PDF still exists) back at queued with a fresh cursor. Returns retried | not_found | not_failed | file_gone.';

-- Shape assert (same habit as 172): anon must not be able to call it.
do $$
begin
  if has_function_privilege('anon', 'public.retry_book_ingestion(uuid)', 'execute') then
    raise exception '271 shape assert: anon can execute retry_book_ingestion';
  end if;
  if not has_function_privilege('authenticated', 'public.retry_book_ingestion(uuid)', 'execute') then
    raise exception '271 shape assert: authenticated cannot execute retry_book_ingestion';
  end if;
end $$;
