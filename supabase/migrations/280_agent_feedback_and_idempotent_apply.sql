-- Agent jobs, step 3b. Written 2026-10-25, NOT yet applied.
--
-- 1. IDEMPOTENT APPLY. If an agent's submit applies its result (stages a batch of deliverables) and then complete_agent_job fails, the job sits in
--    'applying'; the sweep returns it to pending and a second agent run would apply it again, duplicating the batch. staging_batches now carries
--    the job that made it: a partial unique index on (user_id, agent_job_id) makes the second apply a no-op that finds the first batch.
--
-- 2. "FEEDBACK LATER" KINDS: self_mastery.answer_feedback and self_mastery.teach_back_grade. A person's answer / explanation is queued as a job; the agent's
--    grade and feedback attach to it as an ai_feedback_notes row when the agent submits, and are shown the next time the card / lesson is opened. They never
--    gate a rating. The note is built INSIDE apply_agent_feedback_note from the job row (kind, subject, the person's own text), so the agent supplies only
--    the feedback text, rating and follow-up questions, never a card, lesson or user id.
--
-- 3. agent_jobs now has subjects of three types (class, card, lesson) so its single-purpose composite FK to classes is replaced by an ownership check in
--    enqueue_agent_job (the Lead's 128 KB input bound is kept). The kind and subject_type CHECKs are widened.
--
-- All new functions are SECURITY DEFINER as auth.uid() with no user id; anon has no access. No begin;/commit; -- the runner owns the transaction.

-- 1. -------------------------------------------------------------------------------------------------------------------------------
alter table public.staging_batches
  add column if not exists agent_job_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.staging_batches'::regclass and conname = 'staging_batches_agent_job_same_user') then
    alter table public.staging_batches
      add constraint staging_batches_agent_job_same_user
        foreign key (user_id, agent_job_id) references public.agent_jobs (user_id, id) on delete set null (agent_job_id);
  end if;
end;
$$;

create unique index if not exists staging_batches_user_agent_job_key
  on public.staging_batches (user_id, agent_job_id)
  where agent_job_id is not null;

-- 3. -------------------------------------------------------------------------------------------------------------------------------
alter table public.agent_jobs drop constraint if exists agent_jobs_subject_same_user;
alter table public.agent_jobs drop constraint if exists agent_jobs_kind_check;
alter table public.agent_jobs drop constraint if exists agent_jobs_subject_type_check;

alter table public.agent_jobs
  add constraint agent_jobs_kind_check
    check (kind in ('school.announcement_extract', 'school.syllabus_extract', 'school.question_draft', 'self_mastery.answer_feedback', 'self_mastery.teach_back_grade')),
  add constraint agent_jobs_subject_type_check
    check (subject_type is null or subject_type in ('class', 'card', 'lesson'));

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
  -- input_chars is caller-supplied, so bound the stored input itself (a direct RPC could otherwise store any size).
  if p_input is null or octet_length(p_input::text) > 131072 then
    raise exception 'job input too large' using errcode = '22023';
  end if;
  select count(*) into v_live from public.agent_jobs where user_id = v_uid and status in ('pending', 'claimed', 'applying');
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
create table public.ai_feedback_notes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind                text not null check (kind in ('answer_feedback', 'teach_back')),
  card_id             uuid,
  lesson_id           uuid,
  attempt_text        text not null check (char_length(attempt_text) between 1 and 4000),
  feedback_text       text not null check (char_length(feedback_text) between 1 and 1500),
  suggested_rating    smallint check (suggested_rating is null or suggested_rating between 1 and 4),
  follow_up_questions jsonb check (follow_up_questions is null or (jsonb_typeof(follow_up_questions) = 'array' and jsonb_array_length(follow_up_questions) between 1 and 3)),
  provider            text not null default 'mcp',
  model               text,
  agent_job_id        uuid,
  seen_at             timestamptz,
  created_at          timestamptz not null default now(),
  constraint ai_feedback_notes_one_subject check ((card_id is null) <> (lesson_id is null)),
  constraint ai_feedback_notes_kind_subject check ((kind = 'answer_feedback' and card_id is not null) or (kind = 'teach_back' and lesson_id is not null)),
  constraint ai_feedback_notes_card_same_user foreign key (user_id, card_id) references public.cards (user_id, id) on delete cascade,
  constraint ai_feedback_notes_lesson_same_user foreign key (user_id, lesson_id) references public.lessons (user_id, id) on delete cascade,
  constraint ai_feedback_notes_job_same_user foreign key (user_id, agent_job_id) references public.agent_jobs (user_id, id) on delete set null (agent_job_id)
);

create unique index ai_feedback_notes_user_job_key on public.ai_feedback_notes (user_id, agent_job_id) where agent_job_id is not null;
create index ai_feedback_notes_card_idx on public.ai_feedback_notes (user_id, card_id, created_at desc) where card_id is not null;
create index ai_feedback_notes_lesson_idx on public.ai_feedback_notes (user_id, lesson_id, created_at desc) where lesson_id is not null;

alter table public.ai_feedback_notes enable row level security;
create policy ai_feedback_notes_select_own on public.ai_feedback_notes
  for select using (user_id = (select auth.uid()));

-- Called by the app while a job is in 'applying': builds the note from the JOB (its kind, subject and the person's own text), so the agent supplies only
-- the feedback. Idempotent per job (a second call returns 1 without a second note). 0 = no such applying feedback job for the caller.
create or replace function public.apply_agent_feedback_note(p_job_id uuid, p_feedback text, p_rating integer, p_follow_ups jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_job public.agent_jobs;
  v_label text;
  v_attempt text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_job from public.agent_jobs
   where id = p_job_id and user_id = v_uid and status = 'applying' and kind in ('self_mastery.answer_feedback', 'self_mastery.teach_back_grade');
  if v_job.id is null then
    return 0;
  end if;
  if v_job.kind = 'self_mastery.answer_feedback' then
    v_attempt := v_job.input->>'attempt';
  else
    v_attempt := v_job.input->>'explanation';
  end if;
  if v_job.claimed_by is not null then
    select nullif(btrim(label), '') into v_label from public.mcp_access_tokens where id = v_job.claimed_by and user_id = v_uid;
  end if;
  insert into public.ai_feedback_notes (user_id, kind, card_id, lesson_id, attempt_text, feedback_text, suggested_rating, follow_up_questions, provider, model, agent_job_id)
  values (
    v_uid,
    case when v_job.kind = 'self_mastery.answer_feedback' then 'answer_feedback' else 'teach_back' end,
    case when v_job.subject_type = 'card' then v_job.subject_id end,
    case when v_job.subject_type = 'lesson' then v_job.subject_id end,
    left(coalesce(v_attempt, ''), 4000),
    btrim(p_feedback),
    p_rating,
    p_follow_ups,
    'mcp',
    left(coalesce(v_label, 'agent'), 80),
    v_job.id
  )
  on conflict (user_id, agent_job_id) where agent_job_id is not null do nothing;
  return 1;
end;
$$;

-- The person has seen a note: it stops being highlighted as new.
create or replace function public.mark_feedback_note_seen(p_id uuid)
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
  update public.ai_feedback_notes set seen_at = now() where id = p_id and user_id = v_uid and seen_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.enqueue_agent_job(text, text, uuid, jsonb, integer) from public, anon;
revoke all on function public.apply_agent_feedback_note(uuid, text, integer, jsonb) from public, anon;
revoke all on function public.mark_feedback_note_seen(uuid) from public, anon;
grant execute on function public.enqueue_agent_job(text, text, uuid, jsonb, integer) to authenticated, service_role;
grant execute on function public.apply_agent_feedback_note(uuid, text, integer, jsonb) to authenticated, service_role;
grant execute on function public.mark_feedback_note_seen(uuid) to authenticated, service_role;
