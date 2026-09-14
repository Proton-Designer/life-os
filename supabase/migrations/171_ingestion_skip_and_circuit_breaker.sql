-- BUG-1 layer 1 (Phase 1, 2026-09-14). Allocated `171` by the Phase-1 Opus
-- lead, recorded in ALLOCATIONS.md at allocation time.
--
-- THE PROBLEM THIS CLOSES: a single degenerate chunk (real production
-- evidence: chunk 0 of a 203-chunk book, garbled OCR front matter) that
-- exhausts its 3 attempts on a genuine content-shaped failure (a timeout,
-- or an empty-content response) currently fails the ENTIRE BOOK --
-- route.ts's exhausted-attempts branch marks both `ingestion_jobs.stage`
-- and `books.status` as `failed`. One bad position should never be able to
-- kill 202 good ones.
--
-- `skip_ingestion_cursor_position` is the mirror image of `advance_ingestion_
-- cursor` (109): that function refuses to move the cursor UNLESS a
-- succeeded=true attempt exists at the expected position (proof the work
-- finished). This one refuses to move the cursor UNLESS `cursor_attempt >=
-- max_attempts` at the expected position (proof the position genuinely
-- exhausted its budget) -- the same "the database enforces the boundary,
-- not just the app" posture, for the opposite direction. It is NOT a
-- bypass of advance_ingestion_cursor's CAS; it is a distinct, equally
-- guarded operation for a distinct outcome (abandon, not complete).
--
-- WHICH FAILURES ARE ELIGIBLE TO SKIP is decided in route.ts (app code),
-- not here -- this function trusts its caller's `p_next_stage`/
-- `p_next_chunk_index` the same way advance_ingestion_cursor already
-- trusts its own. The caller-side rule (route.ts): skip ONLY for
-- content-shaped failures (timeout, empty_content) via the gateway's own
-- errorKind classification, NEVER for auth/rate_limited/server_error/
-- network/spend-cap-blocked -- those mean OUR infrastructure or budget is
-- broken, not that this one chunk is bad, and skipping past them would
-- silently walk an entire book to "zero lessons found" over hours while
-- blaming the user's file.
--
-- THE CIRCUIT BREAKER: `skipped_positions` (lifetime count for this job)
-- and `consecutive_skipped_positions` (streak since the last genuine
-- success) are both incremented here on every skip. `advance_ingestion_
-- cursor` is CREATE OR REPLACE'd below to reset `consecutive_skipped_
-- positions` to 0 on every real success -- a single bad chunk among many
-- good ones never accumulates a streak. route.ts reads both counters back
-- from this function's own return value and fails the book outright
-- (honest reason: the provider, not the file) once 3 consecutive skips or
-- a real fraction of processed positions have been abandoned -- three
-- consecutive content-shaped timeouts is a degraded provider, not a run of
-- bad luck, and should be reported within minutes, not the ~10 hours it
-- would take to walk all 203 positions at 1/min.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

alter table public.ingestion_jobs
  add column skipped_positions int not null default 0,
  add column consecutive_skipped_positions int not null default 0;

comment on column public.ingestion_jobs.skipped_positions is
  'Lifetime count of per-position (chunk) skips for this job -- BUG-1 layer 1. Never reset. Feeds route.ts''s circuit-breaker ratio check.';
comment on column public.ingestion_jobs.consecutive_skipped_positions is
  'Streak of skips since the last genuine success. Reset to 0 by advance_ingestion_cursor on every real advance. 3+ trips route.ts''s circuit breaker.';

create function public.skip_ingestion_cursor_position(
  p_job_id uuid,
  p_expected_stage public.ingest_stage,
  p_expected_chunk_index int,
  p_expected_attempt int,
  p_next_stage public.ingest_stage,
  p_next_chunk_index int,
  p_skip_reason text
)
returns public.ingestion_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  advanced public.ingestion_jobs;
begin
  if not exists (
    select 1 from public.ingestion_jobs
    where id = p_job_id
      and stage = p_expected_stage
      and cursor_chunk_index is not distinct from p_expected_chunk_index
      and cursor_attempt = p_expected_attempt
      and cursor_attempt >= max_attempts
  ) then
    raise exception
      'skip_ingestion_cursor_position: job % is not at an exhausted position (stage %, chunk %, attempt %) -- refusing to skip a position that has not exhausted its attempts',
      p_job_id, p_expected_stage, p_expected_chunk_index, p_expected_attempt;
  end if;

  update public.ingestion_jobs
  set stage = p_next_stage,
      cursor_chunk_index = p_next_chunk_index,
      cursor_attempt = 0,
      leased_until = null,
      last_error = p_skip_reason,
      skipped_positions = skipped_positions + 1,
      consecutive_skipped_positions = consecutive_skipped_positions + 1
  where id = p_job_id
    and stage = p_expected_stage
    and cursor_chunk_index is not distinct from p_expected_chunk_index
    and cursor_attempt = p_expected_attempt
  returning * into advanced;

  -- Same idempotent-no-op posture as advance_ingestion_cursor: zero rows
  -- updated means the position already moved (a concurrent/retried caller
  -- got here first), not an error.
  return advanced;
end;
$$;

revoke execute on function public.skip_ingestion_cursor_position(uuid, public.ingest_stage, int, int, public.ingest_stage, int, text) from public;
grant execute on function public.skip_ingestion_cursor_position(uuid, public.ingest_stage, int, int, public.ingest_stage, int, text) to service_role;

comment on function public.skip_ingestion_cursor_position(uuid, public.ingest_stage, int, int, public.ingest_stage, int, text) is
  'BUG-1 layer 1. CAS-guarded mirror of advance_ingestion_cursor for the ABANDON case: refuses to move the cursor unless cursor_attempt >= max_attempts at the expected position. Increments skipped_positions/consecutive_skipped_positions. Which failures are eligible to call this is a route.ts (app-code) decision, not enforced here.';

-- CREATE OR REPLACE, same signature as 109's original -- adds ONLY the
-- consecutive-streak reset. Permissions (revoke/grant) are unaffected by
-- REPLACE; they stay attached to the function's identity.
create or replace function public.advance_ingestion_cursor(
  p_job_id uuid,
  p_expected_stage public.ingest_stage,
  p_expected_chunk_index int,
  p_expected_attempt int,
  p_next_stage public.ingest_stage,
  p_next_chunk_index int
)
returns public.ingestion_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  advanced public.ingestion_jobs;
begin
  if not exists (
    select 1 from public.ingestion_job_stage_attempts
    where job_id = p_job_id
      and stage = p_expected_stage
      and chunk_index is not distinct from p_expected_chunk_index
      and attempt = p_expected_attempt
      and succeeded = true
  ) then
    raise exception
      'advance_ingestion_cursor: no successful attempt recorded for job % stage % chunk % attempt % -- refusing to advance a stage the telemetry does not show as finished',
      p_job_id, p_expected_stage, p_expected_chunk_index, p_expected_attempt;
  end if;

  update public.ingestion_jobs
  set stage = p_next_stage,
      cursor_chunk_index = p_next_chunk_index,
      cursor_attempt = 0,
      leased_until = null,
      consecutive_skipped_positions = 0
  where id = p_job_id
    and stage = p_expected_stage
    and cursor_chunk_index is not distinct from p_expected_chunk_index
    and cursor_attempt = p_expected_attempt
  returning * into advanced;

  return advanced;
end;
$$;
