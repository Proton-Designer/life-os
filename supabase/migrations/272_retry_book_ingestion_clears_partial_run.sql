-- Retry must not duplicate a partial run. Written 2026-10-25, NOT yet applied: Opus Lead reviews and applies.
-- Replaces public.retry_book_ingestion (271, already applied) -- same name, signature, grants and return codes, plus one new
-- code: 'has_history'.
--
-- WHY: a run that failed part-way leaves lessons behind. Re-running from 'queued' re-chunks (source_chunks are deleted,
-- which only SETS NULL on lessons.source_chunk_id), and the extraction stage deletes archived lessons by the NEW chunk ids,
-- so the old archived candidates (now chunk-less) and any already-'active' lessons from the partial run both survive, and
-- the merge stage then ranks old and new candidates together: duplicated lessons and cards. So a retry starts from a clean
-- slate: this book's lessons are deleted (cards, card_states and self_explanations cascade).
--
-- WHY IT CAN REFUSE: a book can be studied while it is still being processed ("Start learning now"), and the review log is
-- append-only (a trigger blocks delete, so a cascade would error), and promotions (with their verdicts, which hang off a
-- promotion) and self-explanations are the user's own history.
-- If any of that exists for this book the retry is refused ('has_history') and nothing is touched; the person uploads the
-- file again as a new book instead.
--
-- Returns: 'retried' | 'not_found' | 'not_failed' | 'file_gone' | 'has_history'. Idempotent as before.
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
  if v_file_path is null
     or not exists (select 1 from storage.objects o where o.bucket_id = 'books' and o.name = v_file_path) then
    return 'file_gone';
  end if;

  -- Anything the person did with this book's lessons is history we will not delete.
  if exists (select 1 from public.reviews r where r.book_id = p_book_id and r.user_id = v_uid)
     or exists (select 1 from public.lesson_promotions p join public.lessons l on l.id = p.lesson_id where l.book_id = p_book_id and l.user_id = v_uid)
     or exists (select 1 from public.self_explanations s join public.lessons l on l.id = s.lesson_id where l.book_id = p_book_id and l.user_id = v_uid) then
    return 'has_history';
  end if;

  -- Clean slate for the re-run (cards, card_states, self_explanations cascade from lessons).
  delete from public.lessons where book_id = p_book_id and user_id = v_uid;

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
    insert into public.ingestion_jobs (book_id, user_id, stage) values (p_book_id, v_uid, 'queued');
  end if;

  update public.books
     set status = 'processing', stage = 'queued', progress_pct = 0, error_message = null, lesson_count = 0
   where id = p_book_id and user_id = v_uid;

  return 'retried';
end;
$$;

revoke execute on function public.retry_book_ingestion(uuid) from public, anon;
grant execute on function public.retry_book_ingestion(uuid) to authenticated, service_role;

comment on function public.retry_book_ingestion(uuid) is
  'Owner-only: puts a FAILED book (PDF still in Storage, nothing studied yet) back at queued with a fresh cursor and no leftover lessons. Returns retried | not_found | not_failed | file_gone | has_history.';

do $$
begin
  if has_function_privilege('anon', 'public.retry_book_ingestion(uuid)', 'execute') then
    raise exception '272 shape assert: anon can execute retry_book_ingestion';
  end if;
  if not has_function_privilege('authenticated', 'public.retry_book_ingestion(uuid)', 'execute') then
    raise exception '272 shape assert: authenticated cannot execute retry_book_ingestion';
  end if;
end $$;
