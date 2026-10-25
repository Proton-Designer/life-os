-- Generic agent work queue for request-triggered AI. Written 2026-10-25, NOT yet applied.
--
-- With no AI key, a request that would call the model (extract a syllabus / an announcement, draft questions from notes, ...)
-- is queued instead. A scheduled agent (Claude / ChatGPT through the MCP connector) lists pending jobs, claims them, does the
-- work, and submits a result; the app validates the result with the same parser the in-app path uses and applies it. Design:
-- .claude-scratch/agent-queue-design.md.
--
-- TENANCY: agent_jobs is select-own only for people (RLS). Every state change goes through the SECURITY DEFINER functions
-- below, which act as auth.uid() and take NO user id, so a token can only ever see and move its owner's jobs. The apply step
-- (writing the staged deliverables etc.) happens in app code with the user-scoped client, not here.
--
-- STATES: pending -> claimed (a lease of 30 minutes, attempts + 1) -> applying (submit won the compare-and-set; the app is
-- writing the result) -> done. A lapsed lease returns the job to pending (or failed after 3 attempts); a job not finished by
-- expires_at becomes expired. cancelled / failed are terminal. Finished jobs are deleted after 30 days by sweep_agent_jobs.
--
-- Access: authenticated + service_role for the person/agent functions; sweep_agent_jobs is service_role only.
-- No begin;/commit; -- the runner owns the transaction.

create table public.agent_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('school.announcement_extract', 'school.syllabus_extract', 'school.question_draft')),
  status        text not null default 'pending' check (status in ('pending', 'claimed', 'applying', 'done', 'failed', 'cancelled', 'expired')),
  subject_type  text check (subject_type in ('class')),
  subject_id    uuid,
  input         jsonb not null,
  input_chars   integer not null check (input_chars between 0 and 30000),
  result        jsonb,
  error         text check (error is null or char_length(error) <= 300),
  claimed_by    uuid references public.mcp_access_tokens(id) on delete set null,
  claimed_at    timestamptz,
  lease_until   timestamptz,
  attempts      integer not null default 0 check (attempts >= 0),
  consumed_at   timestamptz,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  expires_at    timestamptz not null default now() + interval '7 days',
  constraint agent_jobs_user_id_id_key unique (user_id, id),
  constraint agent_jobs_subject_same_user
    foreign key (user_id, subject_id) references public.classes (user_id, id) on delete cascade
);

create index agent_jobs_user_status_idx on public.agent_jobs (user_id, status, created_at);

alter table public.agent_jobs enable row level security;

create policy agent_jobs_select_own on public.agent_jobs
  for select using (user_id = (select auth.uid()));

-- Queue a job. Returns its id; raises when the person already has 50 live jobs. A subject, when given, must be the caller's own class.
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
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_subject_id is not null and not exists (select 1 from public.classes where id = p_subject_id and user_id = v_uid) then
    raise exception 'subject not found' using errcode = 'P0002';
  end if;
  -- Lead review: input_chars is caller-supplied, so bound the stored input itself (a direct RPC could otherwise store any size).
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

-- Claim up to p_limit (max 10) jobs: by id, or the oldest pending ones of a kind (any kind when null). A job whose lease lapsed is claimable again.
create or replace function public.claim_agent_jobs(p_kind text, p_limit integer, p_id uuid, p_token_id uuid)
returns table (id uuid, kind text, subject_type text, subject_id uuid, input jsonb, attempts integer, lease_until timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- Lead review: claimed_by gates submit/fail, so it must be one of the caller's own tokens, never another person's.
  if p_token_id is not null and not exists (select 1 from public.mcp_access_tokens t where t.id = p_token_id and t.user_id = v_uid) then
    raise exception 'token not found' using errcode = 'P0002';
  end if;
  return query
  with picked as (
    select j.id as jid
      from public.agent_jobs j
     where j.user_id = v_uid
       and j.expires_at > now()
       and j.attempts < 3
       and (j.status = 'pending' or (j.status = 'claimed' and j.lease_until < now()))
       and (p_kind is null or j.kind = p_kind)
       and (p_id is null or j.id = p_id)
     order by j.created_at
     limit greatest(1, least(coalesce(p_limit, 1), 10))
     for update skip locked
  )
  update public.agent_jobs a
     set status = 'claimed', claimed_by = p_token_id, claimed_at = now(), lease_until = now() + interval '30 minutes', attempts = a.attempts + 1, error = null
    from picked
   where a.id = picked.jid
  returning a.id, a.kind, a.subject_type, a.subject_id, a.input, a.attempts, a.lease_until;
end;
$$;

-- Submit step 1: compare-and-set claimed -> applying for the claimer (live lease). Returns the job so the app can validate and apply it; null = not yours / not claimed / lease lapsed.
create or replace function public.begin_agent_job_submit(p_id uuid, p_token_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.agent_jobs;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.agent_jobs
     set status = 'applying'
   where id = p_id and user_id = v_uid and status = 'claimed' and lease_until > now()
     and (p_token_id is null or claimed_by = p_token_id)
  returning * into v_row;
  if v_row.id is null then
    return null;
  end if;
  return jsonb_build_object('id', v_row.id, 'kind', v_row.kind, 'subject_type', v_row.subject_type, 'subject_id', v_row.subject_id, 'input', v_row.input);
end;
$$;

-- Submit step 2 (success): applying -> done, keeping the validated result.
create or replace function public.complete_agent_job(p_id uuid, p_result jsonb)
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
  update public.agent_jobs set status = 'done', result = p_result, error = null, completed_at = now()
   where id = p_id and user_id = v_uid and status = 'applying';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Submit step 2 (the result was not acceptable): applying -> claimed again with the reason so the agent can retry inside its lease; failed after 3 attempts.
create or replace function public.reject_agent_job_submit(p_id uuid, p_error text)
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
  update public.agent_jobs
     set status = case when attempts >= 3 then 'failed' else 'claimed' end,
         error = left(coalesce(p_error, 'The result was not accepted.'), 300),
         completed_at = case when attempts >= 3 then now() else null end
   where id = p_id and user_id = v_uid and status = 'applying';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- The agent gives up (e.g. unreadable input): claimed -> failed with a short reason shown to the person.
create or replace function public.fail_agent_job(p_id uuid, p_reason text, p_token_id uuid)
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
  update public.agent_jobs set status = 'failed', error = left(coalesce(nullif(btrim(p_reason), ''), 'The agent could not do this.'), 300), completed_at = now()
   where id = p_id and user_id = v_uid and status = 'claimed' and (p_token_id is null or claimed_by = p_token_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- The person cancels a job that is still waiting or claimed (their own).
create or replace function public.cancel_agent_job(p_id uuid)
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
  update public.agent_jobs set status = 'cancelled', completed_at = now()
   where id = p_id and user_id = v_uid and status in ('pending', 'claimed');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- The person has taken a finished job's result into the app (reviewed the drafted questions) or dismissed a failed / expired one: it stops showing.
create or replace function public.consume_agent_job(p_id uuid)
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
  update public.agent_jobs set consumed_at = now() where id = p_id and user_id = v_uid and status in ('done', 'failed', 'expired') and consumed_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Housekeeping, service role only: lapsed leases go back to pending (failed after 3 attempts), overdue jobs expire, old finished jobs are deleted.
create or replace function public.sweep_agent_jobs()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer := 0;
  v_step integer;
begin
  update public.agent_jobs
     set status = case when attempts >= 3 then 'failed' else 'pending' end,
         error = case when attempts >= 3 then 'Your agent did not finish this in time.' else error end,
         completed_at = case when attempts >= 3 then now() else completed_at end
   where status in ('claimed', 'applying') and lease_until < now();
  get diagnostics v_step = row_count; v_n := v_n + v_step;
  update public.agent_jobs set status = 'expired', completed_at = now() where status in ('pending', 'claimed') and expires_at < now();
  get diagnostics v_step = row_count; v_n := v_n + v_step;
  delete from public.agent_jobs where status in ('done', 'failed', 'cancelled', 'expired') and coalesce(completed_at, created_at) < now() - interval '30 days';
  get diagnostics v_step = row_count; v_n := v_n + v_step;
  return v_n;
end;
$$;

revoke all on function public.enqueue_agent_job(text, text, uuid, jsonb, integer) from public, anon;
revoke all on function public.claim_agent_jobs(text, integer, uuid, uuid) from public, anon;
revoke all on function public.begin_agent_job_submit(uuid, uuid) from public, anon;
revoke all on function public.complete_agent_job(uuid, jsonb) from public, anon;
revoke all on function public.reject_agent_job_submit(uuid, text) from public, anon;
revoke all on function public.fail_agent_job(uuid, text, uuid) from public, anon;
revoke all on function public.cancel_agent_job(uuid) from public, anon;
revoke all on function public.consume_agent_job(uuid) from public, anon;
revoke all on function public.sweep_agent_jobs() from public, anon, authenticated;
grant execute on function public.enqueue_agent_job(text, text, uuid, jsonb, integer) to authenticated, service_role;
grant execute on function public.claim_agent_jobs(text, integer, uuid, uuid) to authenticated, service_role;
grant execute on function public.begin_agent_job_submit(uuid, uuid) to authenticated, service_role;
grant execute on function public.complete_agent_job(uuid, jsonb) to authenticated, service_role;
grant execute on function public.reject_agent_job_submit(uuid, text) to authenticated, service_role;
grant execute on function public.fail_agent_job(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.cancel_agent_job(uuid) to authenticated, service_role;
grant execute on function public.consume_agent_job(uuid) to authenticated, service_role;
grant execute on function public.sweep_agent_jobs() to service_role;
