-- Book ingestion with no AI key (agent work queue, step 4). Written 2026-10-25, NOT yet applied.
--
-- A book is a staged pipeline driven by a cursor on ingestion_jobs; the model is called only inside three stages (extracting_lessons per chunk,
-- verifying_grounding per lesson, generating_cards per lesson). With no key but a connected agent, each of those model calls becomes one
-- self_mastery.book_stage agent job (input = the chunk / lesson text, about 12k chars at most). The pipeline and cursor are unchanged; the
-- ingestion job is PARKED (waiting_on_agent_since) while the agent works, the step route skips parked jobs, and a submitted result is validated with
-- the stage's own parser and applied to the stage's output tables (lib/self-mastery/ingestion/stage-apply.ts), idempotently by unit.
--
-- 1. agent_jobs: kind += self_mastery.book_stage, subject_type += book, dedupe_key (one live-or-done job per unit: <book>:<stage>:<unit id>).
-- 2. ingestion_jobs.waiting_on_agent_since + claim_ingestion_job skips parked jobs + park_ingestion_job (service role) + unpark_ingestion_for_book.
-- 3. enqueue_book_stage_jobs (SERVICE ROLE ONLY, takes the owner id, verifies the book is theirs): bulk, idempotent on dedupe_key, own cap
--    (60 live book steps per person), outside the 50-job cap of other kinds.
-- 4. cancel_book_agent_work: the person cancels the remaining jobs and fails the book retryably. retry_book_ingestion clears the parked marker and
--    cancels leftover steps.
--
-- User-callable functions act as auth.uid() with no user id. No begin;/commit; -- the runner owns the transaction.

-- 1. -------------------------------------------------------------------------------------------------------------------------------
alter table public.agent_jobs add column if not exists dedupe_key text;

alter table public.agent_jobs drop constraint if exists agent_jobs_kind_check;
alter table public.agent_jobs drop constraint if exists agent_jobs_subject_type_check;
alter table public.agent_jobs
  add constraint agent_jobs_kind_check
    check (kind in ('school.announcement_extract', 'school.syllabus_extract', 'school.question_draft', 'self_mastery.answer_feedback', 'self_mastery.teach_back_grade', 'self_mastery.book_stage')),
  add constraint agent_jobs_subject_type_check
    check (subject_type is null or subject_type in ('class', 'card', 'lesson', 'book'));

create unique index if not exists agent_jobs_user_dedupe_key
  on public.agent_jobs (user_id, dedupe_key)
  where dedupe_key is not null and status in ('pending', 'claimed', 'applying', 'done');

-- The 50-job cap of enqueue_agent_job counts everything EXCEPT book steps (a book needs hundreds over its life; they have their own cap below).
-- A book is a valid subject for the generic enqueue too.
create or replace function public.enqueue_agent_job(p_kind text, p_subject_type text, p_subject_id uuid, p_input jsonb, p_input_chars integer)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_live integer;
  v_id uuid;
  v_ok boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_kind = 'self_mastery.book_stage' then
    raise exception 'book steps are queued by the ingestion pipeline' using errcode = '42501';
  end if;
  if (p_subject_id is null) <> (p_subject_type is null) then
    raise exception 'subject type and id go together' using errcode = '22023';
  end if;
  if p_subject_id is not null then
    if p_subject_type = 'class' then
      select exists (select 1 from public.classes where id = p_subject_id and user_id = v_uid) into v_ok;
    elsif p_subject_type = 'card' then
      select exists (select 1 from public.cards where id = p_subject_id and user_id = v_uid) into v_ok;
    elsif p_subject_type = 'lesson' then
      select exists (select 1 from public.lessons where id = p_subject_id and user_id = v_uid) into v_ok;
    else
      v_ok := false;
    end if;
    if not v_ok then
      raise exception 'subject not found' using errcode = 'P0002';
    end if;
  end if;
  if p_input is null or octet_length(p_input::text) > 131072 then
    raise exception 'job input too large' using errcode = '22023';
  end if;
  select count(*) into v_live from public.agent_jobs
   where user_id = v_uid and status in ('pending', 'claimed', 'applying') and kind <> 'self_mastery.book_stage';
  if v_live >= 50 then
    raise exception 'too many jobs waiting for your agent' using errcode = '53400';
  end if;
  insert into public.agent_jobs (user_id, kind, subject_type, subject_id, input, input_chars)
  values (v_uid, p_kind, p_subject_type, p_subject_id, p_input, p_input_chars)
  returning id into v_id;
  return v_id;
end;
$$;

-- 2. -------------------------------------------------------------------------------------------------------------------------------
alter table public.ingestion_jobs add column if not exists waiting_on_agent_since timestamptz;
comment on column public.ingestion_jobs.waiting_on_agent_since is
  'Set while the job is PARKED waiting for the owner''s agent to finish its book_stage steps (migration 281). claim_ingestion_job skips parked jobs; unpark_ingestion_for_book / the stuck sweep clear it.';

-- Same as migration 109's body plus one condition: a parked job is not claimable.
create or replace function public.claim_ingestion_job()
returns public.ingestion_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.ingestion_jobs;
begin
  update public.ingestion_jobs
  set leased_until = now() + interval '6 minutes', -- 300s Vercel budget + margin, single-shot, never refreshed
      cursor_attempt = cursor_attempt + 1
  where id = (
    select id from public.ingestion_jobs
    where (leased_until is null or leased_until < now())
      and cursor_attempt < max_attempts
      and stage not in ('done', 'failed')
      and waiting_on_agent_since is null
    order by created_at asc
    limit 1
    for update skip locked
  )
  returning * into claimed;

  return claimed;
end;
$$;

-- Park the claimed job: it waits for the agent. The claim already counted an attempt for this position; nothing was attempted, so give it back.
-- Compare-and-set on the position the caller claimed (null = it already moved).
create or replace function public.park_ingestion_job(p_job_id uuid, p_expected_stage public.ingest_stage, p_expected_chunk_index integer, p_expected_attempt integer)
returns public.ingestion_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  parked public.ingestion_jobs;
begin
  update public.ingestion_jobs
     set waiting_on_agent_since = coalesce(waiting_on_agent_since, now()),
         leased_until = null,
         cursor_attempt = greatest(cursor_attempt - 1, 0)
   where id = p_job_id
     and stage = p_expected_stage
     and cursor_chunk_index is not distinct from p_expected_chunk_index
     and cursor_attempt = p_expected_attempt
  returning * into parked;
  return parked;
end;
$$;

-- A result for the book's step has been applied: the pipeline may continue. Owner only (as auth.uid()).
create or replace function public.unpark_ingestion_for_book(p_book_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.ingestion_jobs
     set waiting_on_agent_since = null
   where book_id = p_book_id and user_id = v_uid and waiting_on_agent_since is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 3. -------------------------------------------------------------------------------------------------------------------------------
-- p_units: [{ "unit_id": "<uuid>", "input": {...} }, ...]. Service role only (the step route plans; it passes the owner it claimed the job for, and the book
-- must be theirs). Idempotent: a unit that already has a live-or-done job is skipped. Own cap: 60 live book steps per person. Returns how many were created.
create or replace function public.enqueue_book_stage_jobs(p_user_id uuid, p_book_id uuid, p_stage text, p_units jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_live integer;
  v_room integer;
  v_unit jsonb;
  v_made integer := 0;
  v_n integer;
begin
  if not exists (select 1 from public.books where id = p_book_id and user_id = p_user_id) then
    raise exception 'book not found' using errcode = 'P0002';
  end if;
  if p_stage not in ('extracting_lessons', 'verifying_grounding', 'generating_cards') then
    raise exception 'not a model stage' using errcode = '22023';
  end if;
  if p_units is null or jsonb_typeof(p_units) <> 'array' then
    raise exception 'units must be an array' using errcode = '22023';
  end if;
  select count(*) into v_live from public.agent_jobs
   where user_id = p_user_id and kind = 'self_mastery.book_stage' and status in ('pending', 'claimed', 'applying');
  v_room := 60 - v_live;
  for v_unit in select * from jsonb_array_elements(p_units) loop
    exit when v_room <= 0;
    if octet_length((v_unit->'input')::text) > 131072 then
      raise exception 'job input too large' using errcode = '22023';
    end if;
    insert into public.agent_jobs (user_id, kind, subject_type, subject_id, input, input_chars, dedupe_key)
    values (
      p_user_id, 'self_mastery.book_stage', 'book', p_book_id,
      jsonb_set(v_unit->'input', '{stage}', to_jsonb(p_stage)),
      coalesce(char_length(v_unit->'input'->>'text'), 0),
      p_book_id::text || ':' || p_stage || ':' || (v_unit->>'unit_id')
    )
    on conflict (user_id, dedupe_key) where dedupe_key is not null and status in ('pending', 'claimed', 'applying', 'done') do nothing;
    get diagnostics v_n = row_count;
    v_made := v_made + v_n;
    v_room := v_room - v_n;
  end loop;
  return v_made;
end;
$$;

-- 4. -------------------------------------------------------------------------------------------------------------------------------
-- The person cancels the agent's work on a book: the remaining steps are cancelled and the book fails RETRYABLY (Try again restarts it).
create or replace function public.cancel_book_agent_work(p_book_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.books where id = p_book_id and user_id = v_uid and status = 'processing') then
    return 0;
  end if;
  update public.agent_jobs
     set status = 'cancelled', completed_at = now()
   where user_id = v_uid and subject_type = 'book' and subject_id = p_book_id and kind = 'self_mastery.book_stage' and status in ('pending', 'claimed', 'applying');
  get diagnostics v_n = row_count;
  update public.ingestion_jobs
     set stage = 'failed', waiting_on_agent_since = null, leased_until = null, last_error = 'cancelled by the owner while waiting for the agent'
   where book_id = p_book_id and user_id = v_uid and stage not in ('done', 'failed');
  update public.books
     set status = 'failed', error_message = 'You cancelled your agent''s work on this book. Tap Try again to start it over.'
   where id = p_book_id and user_id = v_uid and status = 'processing';
  return v_n;
end;
$$;

-- retry_book_ingestion (272) + clears the parked marker and cancels steps still queued for the old run.
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

  if exists (select 1 from public.reviews r where r.book_id = p_book_id and r.user_id = v_uid)
     or exists (select 1 from public.lesson_promotions p join public.lessons l on l.id = p.lesson_id where l.book_id = p_book_id and l.user_id = v_uid)
     or exists (select 1 from public.self_explanations s join public.lessons l on l.id = s.lesson_id where l.book_id = p_book_id and l.user_id = v_uid) then
    return 'has_history';
  end if;

  delete from public.lessons where book_id = p_book_id and user_id = v_uid;

  -- Steps still queued for the old run refer to chunks and lessons that no longer exist.
  update public.agent_jobs
     set status = 'cancelled', completed_at = now()
   where user_id = v_uid and subject_type = 'book' and subject_id = p_book_id and kind = 'self_mastery.book_stage' and status in ('pending', 'claimed', 'applying');

  update public.ingestion_jobs
     set stage = 'queued',
         cursor_chunk_index = null,
         cursor_attempt = 0,
         skipped_positions = 0,
         consecutive_skipped_positions = 0,
         leased_until = null,
         waiting_on_agent_since = null,
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

revoke all on function public.park_ingestion_job(uuid, public.ingest_stage, integer, integer) from public, anon, authenticated;
revoke all on function public.enqueue_book_stage_jobs(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.unpark_ingestion_for_book(uuid) from public, anon;
revoke all on function public.cancel_book_agent_work(uuid) from public, anon;
revoke all on function public.enqueue_agent_job(text, text, uuid, jsonb, integer) from public, anon;
revoke all on function public.claim_ingestion_job() from public, anon, authenticated;
revoke all on function public.retry_book_ingestion(uuid) from public, anon;
grant execute on function public.park_ingestion_job(uuid, public.ingest_stage, integer, integer) to service_role;
grant execute on function public.enqueue_book_stage_jobs(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.unpark_ingestion_for_book(uuid) to authenticated, service_role;
grant execute on function public.cancel_book_agent_work(uuid) to authenticated, service_role;
grant execute on function public.enqueue_agent_job(text, text, uuid, jsonb, integer) to authenticated, service_role;
grant execute on function public.claim_ingestion_job() to service_role;
grant execute on function public.retry_book_ingestion(uuid) to authenticated, service_role;
