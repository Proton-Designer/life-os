-- ULM: per-stage-ATTEMPT telemetry for `ingestion_jobs`. Allocated number 107
-- (LifeOS lead, R5) — apply to SCRATCH ONLY via ./scripts/apply-migration.sh,
-- never bare psql (that is precisely how 095-097/105/106 arrived invisible to
-- the ledger). Production is the LifeOS lead's apply, not this one's.
--
-- WHY THIS EXISTS. docs/specs/L2-ingestion.md §4 promises "the job record
-- stores per-stage timings so regressions are visible rather than felt." It
-- does not, in either repo -- `ingestion_jobs` (074) has stage/attempts/
-- leased_until/heartbeat_at/last_error and no timing columns. The entire
-- historical record of how long ingestion actually takes is two numbers
-- preserved in code comments (pipeline.ts:104, this repo's own header on
-- 074): a ~58 min total run, ~13 min of it in `merging`. Nobody can currently
-- answer "which stage is slow" from data.
--
-- CHILD TABLE, NOT A JSONB COLUMN ON ingestion_jobs -- per the Opus Lead's
-- recommendation to The Boss, for two concrete reasons, not a style
-- preference:
--   1. R3's budget ceiling has to SUM tokens per user. Summing a jsonb blob
--      across rows is a query that works at 10 books and stops working at
--      10,000; summing an indexed column does not.
--   2. ONE ROW PER STAGE ATTEMPT, not per stage. A keyed jsonb blob
--      (`{"extracting_lessons": {...}}`) can hold exactly one value per
--      stage -- a retry that succeeded on its second try overwrites the
--      first attempt's record, silently. Under the cursor model this
--      migration is designed for (see below), retries are the ordinary
--      case, not the exception, and a table row per attempt is what makes
--      that legible rather than collapsed.
--
-- THE CURSOR MODEL THIS FITS (R12, R9 item 5 -- not built here, this table
-- is the instrument for it, not the mechanism). The Boss ruled the MAP half
-- (per-chunk extraction) becomes ONE CHUNK PER INVOCATION with an idempotent
-- cursor (stage + chunk index + attempt) on `ingestion_jobs`, replacing a
-- long-held lease. Vercel is hobby/Fluid, `functionDefaultTimeout` 300s --
-- MAP fits comfortably (measured ~50s/chunk on a local 7B run); REDUCE
-- (`merging`, ~13 min) does not and is NOT solved here (R12.4 -- decided by
-- measurement, not by plan, and not this migration's job). Consequence for
-- this table's shape: `chunk_index` is nullable (chunked stages carry it,
-- whole-book stages like `merging`/`finalizing` don't), and `attempt` is a
-- genuine per-(job, stage, chunk) counter, because under a cursor the same
-- (job, stage, chunk_index) tuple is expected to be hit by more than one
-- invocation -- once for the attempt that fails or times out, again for the
-- retry that lands the cursor forward.
--
-- WHAT DISSOLVES, NOT WHAT'S FIXED. The DO-NOT-PORT warning on
-- `heartbeat_ingestion_job` (this repo's own 074 header, sourced from ULM's
-- `20260815060000_l2_ingestion_job_claim.sql`) is that heartbeat extends a
-- lease unconditionally -- it cannot prove the worker made real progress
-- since the last call, only that it's still alive. That defect is a property
-- of the LEASE model. A cursor does not inherit it: a cursor advancing from
-- (stage, chunk_index, attempt) to the next tuple IS proof of progress --
-- position, not liveness, is what it records, and position cannot be faked
-- by a timer the way a heartbeat can. This table is where that position's
-- history becomes queryable after the fact, once the cursor lands.
--
-- FAILED ATTEMPTS ARE AS RECORDABLE AS SUCCESSFUL ONES -- not an
-- afterthought. Per R12.3, the hallucination firewall's embedding-relevance
-- floor (inside `extracting_lessons`) now fails CLOSED: an embedding failure
-- never admits an ungated lesson, the invocation fails, and the chunk
-- retries. That makes embedder reliability an availability question, and
-- this table's `succeeded`/`error` columns on every attempt -- not just the
-- ones that finished -- are the only place that failure rate becomes
-- visible. A telemetry table that only logs successes measures the wrong
-- population; the schema below makes a failed, unfinished, and successful
-- attempt equally representable, never a special case bolted on.
--
-- NOT BUILT HERE, FLAGGED RATHER THAN SILENTLY OMITTED: the cursor columns
-- on `ingestion_jobs` itself (stage + chunk_index + attempt as the resumable
-- position) are a separate, closely related piece of work this migration
-- does not do. This table can already record attempts once that cursor
-- exists and calls it; it does not itself make the worker resumable. Also
-- not built here: a `books`/`ingestion_jobs`-level aggregate ("N lessons
-- could not be verified", R12.3's user-facing drop count+reason) -- that is
-- a derived summary a future migration or RPC computes FROM this table
-- (count attempts where stage='extracting_lessons' and succeeded=false and
-- retries are exhausted, per job), not a column this migration adds.

-- ---------------------------------------------------------------------------
-- Composite FK target on the parent. Checked via pg_indexes AND pg_constraint
-- before writing this (a unique index alone is a valid FK target and
-- invisible to a constraint-only query -- today's running lesson) that
-- ingestion_jobs carries no (user_id, id) uniqueness yet. `id` is already the
-- primary key, so this adds no new uniqueness guarantee -- it exists solely
-- to be a composite FK target, same trick as every other table hardened this
-- week (058, 089, 097).
-- ---------------------------------------------------------------------------
create unique index if not exists ingestion_jobs_user_id_id_key
  on public.ingestion_jobs (user_id, id);

create table public.ingestion_job_stage_attempts (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null,
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- Reuses ingest_stage (060) rather than a second enum -- one vocabulary
  -- for "what stage is this" across ingestion_jobs.stage and this table,
  -- closing the class of drift a hand-maintained parallel list invites.
  -- Deliberately unrestricted to processing-only values: a future stage
  -- (e.g. tracking queued-to-claimed wait time) is a legitimate use of this
  -- table without a migration to widen a CHECK.
  stage         public.ingest_stage not null,

  -- Null for whole-book stages (merging, finalizing, parsing_structure);
  -- the chunk position for per-chunk stages (chunking, extracting_lessons)
  -- under the cursor model. Not backed by a chunk table -- chunks are
  -- ephemeral pipeline state, not persisted rows, so this is a plain
  -- ordinal, matching the cursor's own (stage, chunk_index) addressing.
  chunk_index   int,

  -- 1-indexed. Numbering a given (job_id, stage, chunk_index)'s attempts is
  -- the CALLER's responsibility (the worker, reading its own cursor state)
  -- -- same division of labour as claim_ingestion_job's attempts counter and
  -- heartbeat_ingestion_job's progress-blindness (074's own header): this
  -- schema records what happened, it does not and cannot arbitrate ordering
  -- among concurrent callers. The unique index below makes a double-claim on
  -- the same attempt number fail loudly rather than silently overwrite.
  attempt       int not null default 1 check (attempt >= 1),

  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  succeeded     boolean,

  tokens_in     int,
  tokens_out    int,

  -- Populated on failure only -- see finish-shape/error-shape checks below.
  -- Free text, same posture as ingestion_jobs.last_error (074): a taxonomy
  -- enum here would need to anticipate every future failure class (embedder
  -- timeout, embedder relevance-floor rejection under R12.3, provider JSON
  -- malformed, chunk read error...) and go stale the day a new one appears.
  error         text,

  created_at    timestamptz not null default now(),

  -- An attempt is either still in flight (both null) or finished with a
  -- verdict (both set) -- never "finished with no verdict" or "has a
  -- verdict but no finish time", which would be an attempt that's both done
  -- and not done at once.
  constraint ingestion_job_stage_attempts_finish_shape
    check (
      (finished_at is null and succeeded is null)
      or (finished_at is not null and succeeded is not null)
    ),

  -- error is meaningful only paired with a recorded failure -- a populated
  -- error on a succeeded=true row would be a silent contradiction nothing
  -- else in this schema catches.
  constraint ingestion_job_stage_attempts_error_shape
    check (error is null or succeeded is false)
);

-- Composite FK, not single-column -- FK checks bypass RLS, so a plain
-- `job_id references ingestion_jobs(id)` would prove only that the job
-- exists, never that the caller (this table's own writer, service_role in
-- practice today, but structural correctness shouldn't depend on who's
-- writing) owns it. Going straight to composite rather than single-column-
-- now-harden-later, unlike this week's earlier tables -- no reason to repeat
-- the churn 086/087/089 existed to fix when the lesson is already known.
alter table public.ingestion_job_stage_attempts
  add constraint ingestion_job_stage_attempts_job_id_fkey
  foreign key (user_id, job_id) references public.ingestion_jobs (user_id, id)
  on delete cascade;

-- Derives user_id from the parent job, never trusts client input -- same
-- shape as set_user_id_from_book (062 and others). In practice this table is
-- only ever written by service_role (the worker), which bypasses RLS
-- entirely; the derivation is structural correctness regardless of who
-- writes, not a defence specifically against a client that has no path to
-- write here at all (see RLS below -- authenticated gets no INSERT policy).
create function public.set_user_id_from_ingestion_job()
returns trigger
language plpgsql
as $$
declare
  owner uuid;
begin
  select user_id into owner from public.ingestion_jobs where id = new.job_id;
  if owner is null then
    raise exception 'ingestion_job_stage_attempts: ingestion job % not found', new.job_id;
  end if;
  new.user_id := owner;
  return new;
end;
$$;

create trigger ingestion_job_stage_attempts_set_user_id
  before insert or update of job_id on public.ingestion_job_stage_attempts
  for each row execute function public.set_user_id_from_ingestion_job();

-- Uniqueness on the attempt-numbering itself: two rows can never claim the
-- same (job, stage, chunk, attempt) tuple. coalesce(chunk_index, -1) rather
-- than a plain column in the index, because a plain UNIQUE treats every NULL
-- as distinct from every other NULL -- two whole-book-stage rows (both
-- chunk_index NULL) with the same (job_id, stage, attempt) would NOT
-- conflict under a naive unique constraint, silently reintroducing the
-- exact ambiguity this index exists to prevent.
create unique index ingestion_job_stage_attempts_uniq_attempt
  on public.ingestion_job_stage_attempts
  (job_id, stage, coalesce(chunk_index, -1), attempt);

-- Timeline-per-job (the L2-spec §4 use case this migration exists for) and
-- R3's per-user token sum both read off this one index -- job-scoped queries
-- filter+sort on the first three columns; a per-user sum scans user_id with
-- started_at available for windowing (e.g. "this month's tokens") without a
-- second index.
create index ingestion_job_stage_attempts_job_timeline
  on public.ingestion_job_stage_attempts (job_id, stage, started_at);
create index ingestion_job_stage_attempts_user_tokens
  on public.ingestion_job_stage_attempts (user_id, started_at);

alter table public.ingestion_job_stage_attempts enable row level security;

-- Read-only for the owning user (progress/debug visibility, same posture as
-- ingestion_jobs itself being "user-visible for progress polling"). NO
-- insert/update/delete policy for `authenticated` -- denied by omission,
-- same append-only-by-omission pattern as `096`'s attempts table. This
-- table is worker-written only: service_role bypasses RLS entirely, so it
-- needs no explicit policy to write here, and giving `authenticated` write
-- access would let a client fabricate its own token/timing telemetry, which
-- is exactly what R3's ceiling must not trust.
create policy ingestion_job_stage_attempts_select_own
  on public.ingestion_job_stage_attempts
  for select to authenticated
  using (user_id = (select auth.uid()));

comment on table public.ingestion_job_stage_attempts is
  'Per-stage-attempt telemetry for ingestion_jobs (L2-ingestion.md §4). One row per attempt, not per stage -- a stage retried under the cursor model produces multiple rows, never overwrites. Worker-written only (service_role); read-only for the owning user via RLS. R3''s budget ceiling sums tokens_in/tokens_out from here.';
