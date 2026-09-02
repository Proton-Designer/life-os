-- ULM: the resumable cursor on `ingestion_jobs`, replacing the held-lease
-- model. Number 109 allocated by the LifeOS lead (R5), 2026-09-02.
--
-- ============================================================================
-- WHY THIS EXISTS. `107` (ingestion_job_stage_attempts) records what
-- happened; it does not make the worker resumable. R12 ruled the MAP half
-- becomes one chunk per invocation with an idempotent cursor (stage + chunk
-- index + attempt) on ingestion_jobs, replacing the held lease. This is that
-- cursor.
-- ============================================================================
--
-- WHAT THIS MIGRATION GUARANTEES, STATED PRECISELY RATHER THAN IMPLIED:
-- **at-least-once invocation, with an idempotent CURSOR ADVANCE.** Calling
-- `advance_ingestion_cursor` twice with the same expected starting position
-- only moves the cursor once -- the second call finds the position already
-- moved and no-ops (returns zero rows, checked by the caller). That is the
-- specific guarantee this migration provides: "an invocation that advances
-- but crashes before returning must not redo" holds because redoing means
-- calling advance again with the SAME expected position, which is a safe
-- no-op by construction (the CAS `where stage = p_expected_stage and
-- cursor_chunk_index is not distinct from p_expected_chunk_index and
-- cursor_attempt = p_expected_attempt` below).
--
-- WHAT THIS MIGRATION DOES NOT AND CANNOT GUARANTEE: that the DOWNSTREAM
-- writes a chunk's processing produces (candidate lesson rows, card rows)
-- are themselves idempotent under "an invocation that crashes after doing
-- work but before advancing." That is the WORKER's responsibility, not
-- something a schema can enforce -- the worker must key its writes for a
-- given unit by (job_id, stage, chunk_index) and delete-then-insert (or
-- upsert) on each attempt of that unit, not append, so a retried chunk
-- overwrites its own prior partial output rather than duplicating it. Not
-- built here; flagging the boundary rather than implying this migration
-- closes it, same posture as `107`'s own header on the job-level "N lessons
-- could not be verified" aggregate.
--
-- ============================================================================
-- THE DO-NOT-PORT DEFECT'S ACTUAL RETIREMENT.
-- `heartbeat_ingestion_job` (ULM's `20260815060000_l2_ingestion_job_claim.sql`,
-- carried into this repo's `074` with its own DO-NOT-PORT header) is an
-- unconditional lease extension with no way to know from inside the database
-- whether the worker made real progress since the last call -- progress-
-- dependence had to live in the caller's discipline, which is exactly the
-- shape of bug that looked fine from every angle except the one nobody
-- checked. A CURSOR DOES NOT INHERIT THIS DEFECT: it records POSITION, not
-- liveness. Advancing from (stage, chunk_index, attempt) to the next tuple
-- IS proof of real, checkable progress -- there is no unconditional
-- "extend and hope" call left to write, because there is no heartbeat left
-- in this design. `heartbeat_ingestion_job()` is dropped below, not kept
-- unused: two coexisting liveness models (a lease a human has to reason
-- about vs. a cursor position a query can just read) is worse than one,
-- and the whole point of this migration is that only one is left.
--
-- CHECKED, NOT ASSUMED, BEFORE DROPPING: grepped this repo (tracking-app)
-- for `heartbeat_ingestion_job` and `heartbeat_at` across `*.ts`/`*.tsx`/
-- `*.sql` (2026-09-02). Zero application-code callers -- every hit is
-- either this migration itself, `074`'s own definition, `107`'s header
-- prose, or `lib/supabase/database.types.ts` (generated from the schema,
-- not a caller -- it will regenerate stale once this lands; regenerating
-- it is a follow-up, not a blocker, and its staleness carries no runtime
-- risk since nothing imports the specific fields being removed). The
-- worker that would have called either does not exist yet in this repo
-- (apps/worker is ULM's reference implementation only) -- dropping now,
-- before a real caller exists, is the cheap direction, same "window is
-- closing" logic R1 used for `attempts`/`request_retention`.
--
-- ============================================================================
-- leased_until: KEPT, MEANING NARROWED, NOT LEFT AMBIGUOUS. It still answers
-- one real question a cursor position cannot: "is anyone actively working
-- this job right now, or did the last invocation vanish without a trace?"
-- Under the OLD model it was refreshed mid-flight by heartbeat (the defect).
-- Under THIS model it is set ONCE per claim, to a fixed duration comfortably
-- covering one chunk's worst case under the 300s Vercel budget, and NEVER
-- refreshed mid-invocation -- there is no heartbeat call left to refresh it.
-- If an invocation dies silently, leased_until simply expires and the next
-- claim reclaims the job at its last successfully-advanced cursor position
-- (not from scratch -- that is the entire point of a cursor over a lease).
-- heartbeat_at is DROPPED, not kept: it was purely "last heartbeat seen," and
-- there is no heartbeat left for it to record.
--
-- ============================================================================
-- attempts -> cursor_attempt: RENAMED, not just repurposed silently. Checked
-- production first: 0 rows in ingestion_jobs (the worker doesn't exist yet on
-- this platform), so this is free -- no live-data churn cost, unlike a rename
-- this week that was rejected for exactly that cost (card_states, R1 draft).
-- The rename matters because the MEANING changed and a same-named column
-- with new meaning is the more dangerous shape, not the safer one: the old
-- `attempts` counted claims of the WHOLE JOB (gated by a job-level
-- max_attempts=3, sane when a job was claimed a handful of times total under
-- the lease model). Under one-chunk-per-invocation, a single 300-page book
-- is dozens of claims by design -- reusing that counter unrenamed would
-- either exhaust max_attempts almost immediately (wrong) or require silently
-- redefining what a leftover-named column means (worse: invisible to a
-- reader who assumes unchanged semantics, the exact trap the Boss's own
-- ingestion-telemetry example warns about). `cursor_attempt` is now scoped
-- to the CURRENT (stage, cursor_chunk_index) position specifically -- reset
-- to 0 by advance_ingestion_cursor on every successful move, incremented by
-- claim_ingestion_job on every claim of that same position. `max_attempts`
-- keeps its name, default, and give-up-after-N-tries meaning UNCHANGED --
-- only what it is compared against is now finer-grained, which is a more
-- correct reading of "give up on this" than the coarse job-level version
-- ever was, not a redefinition to paper over.
--
-- ============================================================================
-- cursor_chunk_index: nullable. null for whole-book stages (merging,
-- finalizing, parsing_structure, done, failed) and for a chunked stage's
-- not-yet-started state; a 0-indexed ordinal for chunked stages
-- (chunking, embedding, extracting_lessons, and now verifying_grounding).
-- Deliberately NOT tied to a literal `source_chunks` row -- it is a
-- stage-relative ordinal the WORKER assigns meaning to (which PDF chunk for
-- extracting_lessons; which surviving-lesson slot for verifying_grounding),
-- matching `107`'s own chunk_index column, which this cursor's advance
-- writes attempts against.
--
-- ============================================================================
-- verifying_grounding: NEW, FIRST-CLASS CHUNKED STAGE (R12 addendum), not
-- folded into `merging`. THE BUG THIS UNDOES: `apps/worker/src/pipeline.ts`
-- (ULM reference) calls `setBookProgress(db, bookId, "merging", 90)`
-- (:762) BEFORE the entailment-gate loop (:791-833) AND before Phase B's
-- per-lesson card generation (:840+) -- the label was set one statement too
-- early, so ~13 real minutes of LLM-backed entailment checks and card
-- generation on the 300pg run were reported under `stage='merging'`,
-- indistinguishable from the actual (much cheaper) merge/dedup pass that
-- name describes. This is the canonical "label set one line too early"
-- case going into the handoff's `05`. THE FIX THIS MIGRATION MAKES POSSIBLE,
-- NOT ITSELF APPLIES: the worker (not built here -- apps/worker does not
-- exist in this repo yet) must call `advance_ingestion_cursor` to
-- `verifying_grounding` the moment the merge pass returns and BEFORE the
-- first entailment check runs, and to `generating_cards` the moment the
-- LAST entailment/backfill decision is made and BEFORE the first card is
-- generated -- stage boundaries must bracket the work, not follow it. This
-- migration's schema enforces the bracketing structurally in one place (see
-- advance_ingestion_cursor's succeeded-attempt requirement below): a stage
-- cannot advance without a matching, finished, succeeded=true row already
-- existing in `ingestion_job_stage_attempts`, which cannot exist unless the
-- worker wrote it immediately around the real work -- a label set one line
-- early would mean the ADVANCE call itself fires before that write exists,
-- and it would be rejected.
--
-- ALTER TYPE ... ADD VALUE ... AFTER is safe to use later in the same apply:
-- apply-migration.sh runs `psql -f` without --single-transaction, so each
-- top-level statement commits before the next runs -- no PG12+ same-
-- transaction restriction applies here.
alter type public.ingest_stage add value 'verifying_grounding' after 'merging';

-- ---------------------------------------------------------------------------
-- ingestion_jobs: the cursor columns + the attempts rename + leased_until's
-- narrowed meaning + heartbeat_at's removal.
--
-- NAME COLLISION WARNING, CONFIRMED NOT A REAL ONE BUT WORTH STOPPING ON:
-- `ingestion_jobs.attempts` (renamed here to `cursor_attempt`) and
-- `ingestion_job_stage_attempts.attempt` (from `107`, singular, a DIFFERENT
-- column on a DIFFERENT table) are two unrelated counters that happen to
-- share most of a name -- confusing enough that a reviewer read this rename
-- as touching `107`'s own unique index
-- (`ingestion_job_stage_attempts_uniq_attempt` on
-- `(job_id, stage, coalesce(chunk_index,-1), attempt)`) before re-checking.
-- It does not: verified via `pg_get_indexdef` BEFORE this migration ---
-- `CREATE UNIQUE INDEX ingestion_job_stage_attempts_uniq_attempt ON
-- public.ingestion_job_stage_attempts USING btree (job_id, stage,
-- COALESCE(chunk_index, '-1'::integer), attempt)` -- and the same command is
-- re-run AFTER applying, below, to confirm it comes back byte-identical
-- rather than assuming the rename (which targets `ingestion_jobs`, not
-- `ingestion_job_stage_attempts`) couldn't have touched it. `ALTER TABLE ...
-- RENAME COLUMN` only ever affects the table it's issued against.
-- ---------------------------------------------------------------------------
alter table public.ingestion_jobs
  rename column attempts to cursor_attempt;

alter table public.ingestion_jobs
  add column cursor_chunk_index int;

alter table public.ingestion_jobs
  drop column heartbeat_at;

comment on column public.ingestion_jobs.cursor_attempt is
  'Attempt count for the CURRENT (stage, cursor_chunk_index) position -- NOT a whole-job counter (renamed from `attempts`, which was; 0 rows on production at rename time, checked first). Reset to 0 by advance_ingestion_cursor on every successful move; incremented by claim_ingestion_job on every claim of the same position. Compared against max_attempts, whose name and give-up-after-N-tries meaning are unchanged.';
comment on column public.ingestion_jobs.cursor_chunk_index is
  'Null for whole-book stages or a chunked stage''s not-yet-started state; a 0-indexed, stage-relative ordinal for chunked stages (chunking, embedding, extracting_lessons, verifying_grounding). The worker assigns its meaning per stage -- not tied to a literal source_chunks row.';
comment on column public.ingestion_jobs.leased_until is
  'Set ONCE per claim to a fixed expiry comfortably covering one chunk under the 300s Vercel budget -- NEVER refreshed mid-invocation (no heartbeat exists in this design). If an invocation dies silently, this simply expires and the next claim resumes at the cursor''s last successfully-advanced position, not from scratch.';

-- claim_ingestion_job: same atomic FOR UPDATE SKIP LOCKED shape as before
-- (074) -- concurrency-safe picking of which job an invocation should work
-- on is still needed under a cursor; a cursor replaces the LEASE'S liveness
-- model, not the CLAIM's mutual-exclusion model. Renamed column, no
-- heartbeat_at write, returns the cursor position so the caller knows
-- exactly what unit to process next.
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
    order by created_at asc
    limit 1
    for update skip locked
  )
  returning * into claimed;

  return claimed;
end;
$$;

revoke execute on function public.claim_ingestion_job() from public;
grant execute on function public.claim_ingestion_job() to service_role;

-- advance_ingestion_cursor: the idempotent CAS advance. Structural guard,
-- not just a documented calling convention: refuses to move the cursor
-- unless a matching, FINISHED, SUCCEEDED=true row already exists in
-- ingestion_job_stage_attempts for the exact position being left -- a stage
-- transition cannot outrun the telemetry proving the work it describes
-- actually happened and actually succeeded. This is the concrete mechanism
-- behind "stage boundaries must bracket the work": it is not merely asked
-- of the worker, it is refused by the database if the worker gets the order
-- wrong.
create function public.advance_ingestion_cursor(
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
      cursor_attempt = 0,       -- fresh position: next claim increments to 1
      leased_until = null       -- this invocation is done with its unit; release it
  where id = p_job_id
    and stage = p_expected_stage
    and cursor_chunk_index is not distinct from p_expected_chunk_index
    and cursor_attempt = p_expected_attempt
  returning * into advanced;

  -- Zero rows updated means the position already moved -- a concurrent or
  -- retried caller got here first. NOT an error: this is the idempotent
  -- no-op the "advances but crashes before returning must not redo"
  -- guarantee depends on. The caller checks whether a row came back and
  -- treats a null return as "already advanced," not as failure.
  return advanced;
end;
$$;

revoke execute on function public.advance_ingestion_cursor(uuid, public.ingest_stage, int, int, public.ingest_stage, int) from public;
grant execute on function public.advance_ingestion_cursor(uuid, public.ingest_stage, int, int, public.ingest_stage, int) to service_role;

drop function public.heartbeat_ingestion_job(uuid);

comment on function public.claim_ingestion_job() is
  'Atomically claims the next eligible job (FOR UPDATE SKIP LOCKED), returns its current cursor position (stage, cursor_chunk_index, cursor_attempt). Sets a single-shot leased_until -- never refreshed; see the table comment on leased_until.';
comment on function public.advance_ingestion_cursor(uuid, public.ingest_stage, int, int, public.ingest_stage, int) is
  'CAS-guarded, idempotent cursor advance. Refuses to move the cursor unless a matching succeeded=true row already exists in ingestion_job_stage_attempts for the position being left (structural stage-boundary bracketing). Calling twice with the same expected position is safe -- the second call affects zero rows.';
