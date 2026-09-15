-- 214: Lecture transcription (P3-15, Team B, tracking-app-4b). Async job
-- table for BYOK transcription (OpenAI Whisper or Gemini) of a
-- lecture_recordings row, processed by a cron-polled worker
-- (lib/school/lecture-transcription-worker.ts), never inline in a Server
-- Action (a real transcription call can run well past a Vercel function's
-- time budget for a long lecture).
--
-- Revised per tracking-app-a9's review (4 changes, all folded in below):
-- stuck-job reclaim + retry cap, a security-definer requeue path (RLS has
-- no UPDATE policy, so a bare client-side "set status back to queued"
-- would silently no-op -- the exact P4-23 bug class), a tighter INSERT
-- check, and the standard touch_updated_at trigger.
--
-- (user_id, id) UNIQUE on lecture_recordings: migration 211 never added
-- this -- it only needed lecture_recordings AS THE REFERENCING side of a
-- composite FK (into classes), never as a composite FK TARGET itself. This
-- migration needs it now, same shape classes_user_id_id_key (058) and
-- books_user_id_id_key (178's own header) already provide for their
-- tables.
alter table public.lecture_recordings
  add constraint lecture_recordings_user_id_id_key unique (user_id, id);

-- unique(recording_id): one transcript per recording. Re-transcribing
-- reuses this same row (via requeue_lecture_transcription below) rather
-- than inserting a second one -- there is exactly one "current" transcript
-- per recording, never a history of attempts.
--
-- claimed_at / attempt_count: a worker that crashes or times out mid-call
-- leaves a row stuck in 'processing' forever with nothing to reclaim it.
-- claim_lecture_transcription_job() below both stamps these on every claim
-- and re-claims a 'processing' row whose claimed_at is stale, up to 3
-- attempts, after which it's given up on and marked 'failed' rather than
-- retried forever.
create table public.lecture_transcripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recording_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  provider text null check (provider in ('openai', 'google')),
  transcript_text text null,
  error_message text null,
  duration_seconds numeric null,
  cost_usd numeric null,
  claimed_at timestamptz null,
  attempt_count int not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lecture_transcripts_recording_same_user
    foreign key (user_id, recording_id) references public.lecture_recordings (user_id, id) on delete cascade,

  unique (recording_id)
);

create index lecture_transcripts_user_id_idx on public.lecture_transcripts (user_id);
-- Partial index backing claim_lecture_transcription_job()'s own query shape below.
create index lecture_transcripts_queued_idx on public.lecture_transcripts (created_at) where status = 'queued';
create index lecture_transcripts_stuck_idx on public.lecture_transcripts (claimed_at) where status = 'processing';

alter table public.lecture_transcripts enable row level security;

create policy "lecture_transcripts_select_own"
  on public.lecture_transcripts for select
  using (user_id = (select auth.uid()));

-- A signed-in user may INSERT a fresh row directly (defense-in-depth --
-- requeue_lecture_transcription() below is the sanctioned path this repo's
-- own Server Actions actually use, INSERT-or-UPDATE in one call, but a
-- direct PostgREST insert must still be constrained the same way): only as
-- 'queued', with every result-shaped column null, so a direct API call
-- can't pre-seed a fabricated transcript/cost/error that the UI would then
-- render as if a real job had run.
create policy "lecture_transcripts_insert_queued_own"
  on public.lecture_transcripts for insert
  with check (
    user_id = (select auth.uid())
    and status = 'queued'
    and provider is null
    and transcript_text is null
    and error_message is null
    and cost_usd is null
  );

-- DELIBERATELY no update/delete policy for `authenticated`. Every status
-- transition after the initial insert (queued -> processing ->
-- completed/failed, plus writing transcript_text/provider/duration_seconds/
-- cost_usd, plus re-queuing an existing row for a retry) happens ONLY
-- through claim_lecture_transcription_job() / requeue_lecture_transcription()
-- below and the cron worker's service-role client, all of which bypass RLS
-- by design (lib/supabase/service-role.ts's own header explains the
-- pattern; requeue_lecture_transcription() instead checks auth.uid() itself
-- in the function body, same shape migration 048's delete_class_assessment
-- already uses). With RLS enabled and no applicable policy, Postgres denies
-- the command outright for `authenticated` -- a user's own UPDATE call
-- affects zero rows, not an error and not a silent write of arbitrary
-- content.

comment on table public.lecture_transcripts is
  'One row per lecture_recordings row a transcription was ever requested '
  'for. status drives an async cron-polled worker '
  '(lib/school/lecture-transcription-worker.ts). RLS grants owners SELECT '
  'and a constrained INSERT only -- every status transition and every '
  'requeue happens through security-definer functions, never a bare '
  'client-side UPDATE (there is no UPDATE policy).';

comment on column public.lecture_transcripts.provider is
  '''openai'' or ''google'' -- whichever BYOK key the worker used. Null '
  'until a job actually starts processing.';

comment on column public.lecture_transcripts.cost_usd is
  'REAL cost from the provider''s own reported duration '
  '(lib/ai/transcription-pricing.ts''s computeActualTranscriptionCostUsd), '
  'logged to ai_usage_log via recordUsage() at the same time -- this '
  'column is a per-recording convenience read, not a second source of '
  'truth for spend accounting.';

comment on column public.lecture_transcripts.claimed_at is
  'When claim_lecture_transcription_job() last picked this row up. Used '
  'to detect a stuck ''processing'' row (worker crashed/timed out) so it '
  'can be reclaimed, up to attempt_count''s limit.';

comment on column public.lecture_transcripts.attempt_count is
  'How many times a worker has claimed this row. Reset to 0 on a fresh '
  'user-initiated requeue (requeue_lecture_transcription) -- a deliberate '
  'retry is not part of the same crash-loop budget as an earlier attempt.';

-- Atomic job claim: FOR UPDATE SKIP LOCKED means two overlapping cron
-- invocations can never claim the same row. Also reclaims a 'processing'
-- row stuck for more than 15 minutes (this worker's own real time budget --
-- see lecture-transcription-worker.ts), up to 3 attempts; a row that has
-- already used all 3 is swept to 'failed' with a clear message instead of
-- being retried forever. Returns NULL (not a row of nulls) when nothing is
-- claimable -- an uninitialized plpgsql composite variable is NULL until
-- assigned, so a 0-row UPDATE leaves v_row NULL, letting the worker check
-- `data === null` the same way advance_ingestion_cursor's callers already
-- do (lib/self-mastery/untyped-from.ts's own header documents that exact
-- convention).
create or replace function public.claim_lecture_transcription_job()
returns public.lecture_transcripts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.lecture_transcripts;
begin
  update public.lecture_transcripts
  set status = 'failed',
      error_message = 'Gave up after 3 attempts -- the worker crashed or timed out each time.',
      updated_at = now()
  where status = 'processing'
    and claimed_at < now() - interval '15 minutes'
    and attempt_count >= 3;

  update public.lecture_transcripts
  set status = 'processing',
      claimed_at = now(),
      attempt_count = attempt_count + 1,
      updated_at = now()
  where id = (
    select id from public.lecture_transcripts
    where status = 'queued'
       or (status = 'processing' and claimed_at < now() - interval '15 minutes' and attempt_count < 3)
    order by created_at asc
    limit 1
    for update skip locked
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Server-only RPC (CLAUDE.md hard rule): Supabase's default privileges grant
-- EXECUTE to anon/authenticated on every new function, so this must be
-- revoked explicitly -- only the cron worker's service-role client may ever
-- call this.
revoke all on function public.claim_lecture_transcription_job() from public, anon, authenticated;
grant execute on function public.claim_lecture_transcription_job() to service_role;

-- The sanctioned client-facing path for "request a transcription" AND
-- "retry a failed one" -- both are the same operation (insert-or-reset this
-- recording's one transcript row to 'queued'), which is exactly why it's
-- one INSERT ... ON CONFLICT rather than app-code branching on whether a
-- row already exists. security definer because resetting an EXISTING row
-- is an UPDATE, which no RLS policy grants `authenticated` (see this
-- table's own header) -- ownership is checked explicitly against
-- lecture_recordings in the function body instead, same pattern migration
-- 048's delete_class_assessment already uses, so a definer-run context is
-- still safe.
create or replace function public.requeue_lecture_transcription(p_recording_id uuid)
returns public.lecture_transcripts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.lecture_transcripts;
begin
  if not exists (
    select 1 from public.lecture_recordings
    where id = p_recording_id and user_id = v_user_id
  ) then
    raise exception 'recording not found or not owned by caller';
  end if;

  -- Race fix (tracking-app-a9 review): a requeue must NEVER reset a row
  -- that's genuinely mid-flight ('processing', still inside its 15-minute
  -- claim window) -- doing so would let the in-flight worker's eventual
  -- write land on top of a freshly-reset row (double-processing, possibly
  -- double-billing the provider) AND resets attempt_count to 0, letting a
  -- user bypass the crash-retry cap by spamming retries. The WHERE clause
  -- below only allows the reset when the existing row is 'completed',
  -- 'failed', or a 'processing' row that's gone stale past the same
  -- 15-minute window claim_lecture_transcription_job() itself uses to
  -- reclaim stuck jobs.
  insert into public.lecture_transcripts (user_id, recording_id, status)
  values (v_user_id, p_recording_id, 'queued')
  on conflict (recording_id) do update set
    status = 'queued',
    provider = null,
    transcript_text = null,
    error_message = null,
    duration_seconds = null,
    cost_usd = null,
    claimed_at = null,
    attempt_count = 0,
    updated_at = now()
  where lecture_transcripts.status in ('completed', 'failed')
     or (lecture_transcripts.status = 'processing' and lecture_transcripts.claimed_at < now() - interval '15 minutes')
  returning * into v_row;

  if v_row.id is not null then
    return v_row;
  end if;

  -- The conflict update above was skipped -- either the row was already
  -- 'queued' (nothing to do, hand it back as-is) or it's genuinely
  -- 'processing' within its window (a real conflict: refuse rather than
  -- silently doing nothing).
  select * into v_row from public.lecture_transcripts where recording_id = p_recording_id;

  if v_row.status = 'queued' then
    return v_row;
  end if;

  raise exception 'transcription already in progress';
end;
$$;

revoke all on function public.requeue_lecture_transcription(uuid) from public, anon;
grant execute on function public.requeue_lecture_transcription(uuid) to authenticated;

drop trigger if exists lecture_transcripts_touch_updated_at on public.lecture_transcripts;
create trigger lecture_transcripts_touch_updated_at
  before update on public.lecture_transcripts for each row execute function public.touch_updated_at();
