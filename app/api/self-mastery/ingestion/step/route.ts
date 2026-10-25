import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { bracketStage, describeError } from "@/lib/self-mastery/ingestion/telemetry";
import { STAGE_HANDLERS } from "@/lib/self-mastery/ingestion/worker-stages";
import { recordIngestionDriverHeartbeat } from "@/lib/self-mastery/ingestion-availability";
import { sweepStuckBooks } from "@/lib/self-mastery/ingestion/stuck-sweep";
import { estimateBookProgressPct } from "@/lib/self-mastery/ingestion-progress";
import { untypedFrom, untypedRpc } from "@/lib/self-mastery/untyped-from";
import { GatewayCallFailedError } from "@/lib/self-mastery/ingestion/llm/deepseek-provider";
import type { IngestStage } from "@/lib/self-mastery/types";
import { runStepLoop, type StepOutcome } from "@/lib/self-mastery/ingestion/step-loop";
import { AI_BLOCK_MESSAGE } from "@/lib/self-mastery/ingestion/failure-messages";
import { HOP_HEADER, kickNextHop, parseHop } from "@/lib/self-mastery/ingestion/step-chain";

/**
 * A5 gates 3-4, plus S6's driver wiring (2026-09-14): one ingestion chunk
 * per invocation, driven by a pg_cron + pg_net poll (the same idiom as
 * `mcp-scheduled-actions`, jobid 2 — see the build report for the exact SQL
 * and the recommended cadence). Reads `ingestion_jobs`' cursor position via
 * `claim_ingestion_job`, does exactly the one stage/chunk's work, and
 * advances via `advance_ingestion_cursor` — never routes around it.
 *
 * LOOPS WITHIN ONE INVOCATION (2026-10-25; this used to say "still one stage per invocation, not looped"). A real book is
 * ~130 chunk-sized steps, each a few seconds of work, and one step per one-minute poll made that hours of wall clock. The
 * body below the heartbeat is `runStep` (claim -> stage -> advance -> books sync, exactly the old single-shot code and
 * writes, every old return now a `halt`), driven by `runStepLoop` (lib/self-mastery/ingestion/step-loop.ts) until the
 * time budget (LOOP_BUDGET_MS, counting the slowest step so far) is spent, nothing is left to claim, or a step is not a
 * clean advance (failure, skip, circuit breaker, a cursor another invocation already moved). The nine original tests
 * still pin the single-step behaviour (their mock now hands out one job, then an empty queue); the loop has its own.
 * A step is durable once its advance lands, so a crash anywhere loses at most the step in flight (lease expiry, CAS).
 * Overlapping polls are safe: `advance_ingestion_cursor` releases the lease, `claim_ingestion_job` is SKIP LOCKED and the
 * advance is a CAS, so two invocations can interleave on one job; the loser steps aside (`stopped`).
 *
 * SELF-CHAINING: a 'budget' stop means work remains, so the route asks the database to POST to itself again
 * (`kick_ingestion_driver`, migration 273, a pg_net call: same origin as the cron, asynchronous, rate-guarded to one kick
 * per 20 s) with the hop in `x-ingestion-hop`, capped at MAX_HOPS; `INGESTION_SELF_CHAIN=off` disables it. Never after
 * any other stop. The 1-minute cron stays the fallback. See lib/self-mastery/ingestion/step-chain.ts.
 *
 * HEARTBEAT ON EVERY AUTHENTICATED CALL, EVEN "NOTHING TO DO" — see
 * `recordIngestionDriverHeartbeat`'s own header. `isIngestionAvailable()`
 * gates the upload UI on this route having been hit recently, not on
 * whether a job happened to exist at that moment; an idle driver (no books
 * queued) must still read as "available," so the write happens before the
 * claim, unconditionally once auth passes.
 *
 * `books.stage`/`books.progress_pct` ARE NOW SYNCED HERE, ON EVERY
 * SUCCESSFUL ADVANCE — closing a real, found-live bug: `books` and
 * `ingestion_jobs` each carry their own `stage` column, and until this
 * pass NOTHING ever wrote the `books` one past its `'queued'` default
 * outside of `finalizingStage`'s own terminal write. Every reader in this
 * repo (get-library.ts, get-in-progress-books.ts, get-book-detail.ts)
 * selects `books.stage`, not `ingestion_jobs.stage` — so a book deep into
 * `generating_cards` was displaying "Reading your book" (and, past
 * `NO_WORKER_THRESHOLD_MS`, the actively wrong "Not yet started") for its
 * entire run. See `lib/self-mastery/ingestion-progress.ts`'s header for
 * the full account. Skipped for `done`/`failed` — `finalizingStage` (and,
 * on the exhausted-attempts path below, this route itself) already owns
 * those terminal writes; this sync must never race or clobber them.
 *
 * WHY maxDuration IS SET EXPLICITLY: Vercel Hobby, Fluid compute,
 * `functionDefaultTimeout` 300s. The whole point of the cursor model (109)
 * is that no single invocation needs more than one chunk's worth of work —
 * 280s leaves margin for cold start and response overhead while still
 * catching a genuinely runaway invocation well before the platform's own
 * hard ceiling would.
 *
 * IDEMPOTENCY GUARANTEE STATED EXPLICITLY, not implied: at-least-once
 * invocation, idempotent writes. `claim_ingestion_job`'s `FOR UPDATE SKIP
 * LOCKED` means two concurrent callers can never claim the SAME row at
 * once, but a caller that claims, does the work, and crashes before this
 * function returns leaves the job re-claimable once its lease expires —
 * the NEXT claim gets a fresh `cursor_attempt`, redoes the same stage/chunk
 * (worker-stages.ts's handlers are read-then-compute-then-return, no
 * destructive writes of their own yet), and `advance_ingestion_cursor`'s
 * own CAS (109) makes a redundant advance call a safe no-op rather than a
 * double-move. This route adds no idempotency logic beyond calling that
 * function correctly — the guarantee is the DB's, not reimplemented here.
 * The `books` sync above inherits the same idempotency for free: it is
 * only ever written alongside a successful advance, so a retried/redundant
 * invocation re-derives and re-writes the SAME estimate for the SAME
 * position rather than compounding anything.
 *
 * BRACKETS THE STAGE'S WORK, NOT THE HTTP REQUEST — carried over from gate
 * 2's own finding: `bracketStage` wraps only the call to the stage
 * handler, after auth/claim and before the response is built, so a
 * measured duration never includes request parsing, auth, or the claim
 * call itself. Any future edit that widens what's inside the bracketed
 * call is reintroducing the exact defect gate 2 exists to catch.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 280;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Ingestion's own secret — deliberately NOT `E2E_TEST_SECRET` or
 * `CRON_SECRET`. This route spends a user's model budget once a real
 * provider is wired; sharing a credential with a test-only or
 * reachability-only route would mean a leak of either one exposes spend,
 * not just test data or a no-op ping. Fails CLOSED on an unset secret —
 * an unconfigured route must never become an open one.
 */
function checkIngestionSecret(request: Request): boolean {
  const expected = process.env.SELF_MASTERY_INGESTION_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeEqual(token, expected);
}

/**
 * Shared by both fail-the-book paths (an infrastructure-shaped exhaustion,
 * and the circuit breaker tripping after too many content-shaped skips) --
 * BUG-1 layer 1/2. Two writes, `ingestion_jobs` first: if that one fails
 * there is nothing durable to build on, so it's returned as a hard error.
 * `books` is best-effort, matching the pre-existing posture here -- a
 * cosmetic sync failing must not be reported as though the real
 * failure-recording failed too.
 */
async function failBook(
  supabase: SupabaseClient,
  params: { jobId: string; bookId: string; jobErrorMessage: string; bookErrorMessage: string },
): Promise<{ ok: true } | { ok: false; failError: string }> {
  const { error: failError } = await supabase
    .from("ingestion_jobs")
    .update({ stage: "failed", last_error: params.jobErrorMessage })
    .eq("id", params.jobId);
  if (failError) {
    return { ok: false, failError: failError.message };
  }

  const { error: bookFailError } = await untypedFrom(supabase, "books")
    .update({ status: "failed", error_message: params.bookErrorMessage })
    .eq("id", params.bookId);
  if (bookFailError) {
    console.error("[self-mastery ingestion] failed to sync books.status='failed'", bookFailError.message);
  }
  return { ok: true };
}

/**
 * The real denominator for a chunked stage's within-stage progress climb
 * (2026-09-15, the Lead's fix -- see ingestion-progress.ts's own header for
 * the full incident: book 3d7a3825 sat visibly frozen at 55%/97% for hours
 * because the OLD static curve saturates long before a real book's true
 * position gets there). One cheap COUNT query, and only for the three
 * stages that actually have a within-stage span to climb -- everything else
 * returns `null` immediately, no query issued. Mirrors the exact row sets
 * worker-stages.ts's own handlers walk: `extractingLessonsStage` iterates
 * ALL of a book's `source_chunks`; `verifyGroundingStage` and
 * `generatingCardsStage` both iterate the identical `rank IS NOT NULL`
 * lesson set, in the same rank order (see either handler's own header), so
 * they share one denominator here too. FAILS SOFT (`null`, never throws) on
 * a count error -- a failed count must fall back to
 * `estimateBookProgressPct`'s own static curve, not break the actual cursor
 * advance this total only decorates.
 */
async function fetchStageTotal(supabase: SupabaseClient, stage: IngestStage, bookId: string): Promise<number | null> {
  if (stage === "extracting_lessons") {
    const { count, error } = await supabase
      .from("source_chunks")
      .select("id", { count: "exact", head: true })
      .eq("book_id", bookId);
    return error || count === null ? null : count;
  }
  if (stage === "verifying_grounding" || stage === "generating_cards") {
    const { count, error } = await supabase
      .from("lessons")
      .select("id", { count: "exact", head: true })
      .eq("book_id", bookId)
      .not("rank", "is", null);
    return error || count === null ? null : count;
  }
  return null;
}

/**
 * `books.stage`/`books.progress_pct` sync, shared by both call sites below
 * (a genuine advance, and the exhausted-attempts skip path) -- previously
 * duplicated inline at each. `stage` is written unconditionally (it is the
 * cursor's own truth, and always moves forward with it); `progress_pct` is
 * written ONLY if the freshly estimated value is HIGHER than whatever is
 * already stored, via a single atomic `UPDATE ... WHERE progress_pct <
 * :next` rather than a read-then-write -- no race to reason about, no extra
 * read. NEVER MOVES BACKWARDS (2026-09-15, the Lead's fix): deploying this
 * more-accurate estimate mid-run must not visibly regress a book that had
 * already climbed higher under the OLD, overly-eager curve (book 3d7a3825
 * was reading 97% at lesson 11 of 60 -- the new, correct estimate for that
 * same position is ~86%, which must never overwrite the already-stored 97).
 * Both writes are best-effort, matching the pre-existing posture at both
 * call sites: the cursor has already, durably advanced by the time this
 * runs, so a cosmetic sync failure must never turn a real success into a
 * reported one.
 */
async function syncBookProgress(supabase: SupabaseClient, bookId: string, stage: IngestStage, chunkIndex: number | null): Promise<void> {
  const total = await fetchStageTotal(supabase, stage, bookId);
  const nextProgressPct = estimateBookProgressPct(stage, chunkIndex, total);

  const { error: stageSyncError } = await untypedFrom(supabase, "books").update({ stage }).eq("id", bookId);
  if (stageSyncError) {
    console.error("[self-mastery ingestion] failed to sync books.stage", stageSyncError.message);
  }

  if (nextProgressPct !== null) {
    const { error: progressSyncError } = await untypedFrom(supabase, "books")
      .update({ progress_pct: nextProgressPct })
      .eq("id", bookId)
      .lt("progress_pct", nextProgressPct);
    if (progressSyncError) {
      console.error("[self-mastery ingestion] failed to sync books.progress_pct", progressSyncError.message);
    }
  }
}

/** What one trip through claim -> stage -> advance produced. See step-loop.ts for what each kind does to the loop. */
async function runStep(supabase: ReturnType<typeof createServiceRoleClient>): Promise<StepOutcome> {
  const halt = (body: Record<string, unknown>, init?: { status?: number }): StepOutcome => ({ kind: "halt", status: init?.status ?? 200, body });

  const { data: job, error: claimError } = await supabase.rpc("claim_ingestion_job");
  if (claimError) {
    return halt({ ok: false, reason: "claim_failed", error: claimError.message }, { status: 500 });
  }
  // BUG FOUND LIVE, running item 7 against an empty ingestion_jobs table:
  // `claim_ingestion_job` (109) is declared to RETURN a `public.ingestion_jobs`
  // composite. When its own `UPDATE ... RETURNING * INTO claimed` matches zero
  // rows (no eligible job), `claimed` is left as a ROW OF NULLS, not a genuine
  // SQL NULL -- `select claim_ingestion_job() is null` is `true` at the SQL
  // level (composite-null semantics), but PostgREST serializes that same value
  // over the RPC boundary as a JSON OBJECT with every field null
  // (`{"id":null,"stage":null,...}`), confirmed directly against the REST
  // endpoint, not assumed. `!job` is false for that object (it's a truthy
  // JS object), so this check was silently dead code for the exact "nothing
  // to do" case it exists to catch -- every empty-queue poll fell through to
  // `STAGE_HANDLERS[null]` and returned a 501 `stage_not_implemented` instead
  // of the intended 200 `no_eligible_job`. `job.id` is this table's primary
  // key and can never be legitimately null for a real claimed row, so it's
  // the correct discriminator here without touching the RPC's return shape.
  if (!job || job.id === null) {
    return { kind: "no_job", status: 200, body: { ok: true, reason: "no_eligible_job" } };
  }

  const handler = STAGE_HANDLERS[job.stage];
  if (!handler) {
    // Named, not swallowed: an unimplemented stage is a 501, not a silent
    // 200 that would look identical to real progress from the outside.
    return halt(
      { ok: false, reason: "stage_not_implemented", stage: job.stage, jobId: job.id },
      { status: 501 },
    );
  }

  const expectedStage = job.stage;
  const expectedChunkIndex = job.cursor_chunk_index;
  const expectedAttempt = job.cursor_attempt;

  let work;
  try {
    work = await bracketStage(
      supabase,
      { jobId: job.id, stage: expectedStage, chunkIndex: expectedChunkIndex, attempt: expectedAttempt },
      () => handler({ job, supabase }),
    );
  } catch (e) {
    // bracketStage already recorded this attempt as succeeded=false with
    // the error. Do NOT call advance_ingestion_cursor here — there is no
    // succeeded=true row for this exact position, so it would refuse
    // anyway (109's own CAS guard) — not routing around the DB's refusal,
    // just not fighting it with a call that can only fail.
    // Same "[object Object]" bug as telemetry.ts's own bracketStage catch --
    // a thrown Supabase PostgrestError isn't `instanceof Error`. Shared fix.
    const errorMessage = describeError(e);

    // A refusal that is about the ACCOUNT (no key, this user's monthly budget, the shared budget) cannot succeed on a retry
    // a few minutes later: fail the book NOW, on attempt 1, with a message that says what to do. These stay retryable from
    // the library ("Try again") once the key is added or the budget clears. The signal is the gateway's typed flag, never
    // the message text. Only deterministic blocks take this path; a timeout or empty reply keeps the retry/skip logic below.
    if (e instanceof GatewayCallFailedError && e.blockKind) {
      const failed = await failBook(supabase, {
        jobId: job.id,
        bookId: job.book_id,
        jobErrorMessage: `${expectedStage} (chunk ${expectedChunkIndex}): ${e.blockKind} -- ${errorMessage}`,
        bookErrorMessage: AI_BLOCK_MESSAGE[e.blockKind],
      });
      return halt(
        { ok: false, reason: "ai_blocked", blockKind: e.blockKind, stage: expectedStage, chunkIndex: expectedChunkIndex, error: errorMessage, bookMarkedFailed: failed.ok },
        { status: 500 },
      );
    }

    // GATE 5: max_attempts enforced at the cursor. claim_ingestion_job's
    // own WHERE clause (109) already excludes `cursor_attempt >=
    // max_attempts` from ever being claimed again — that half needed no
    // work here. THE GAP: nothing marked the job's `stage` as `failed` when
    // that threshold was crossed, so an exhausted job didn't stop being
    // claimed by ACCIDENT (it structurally couldn't be) but it also never
    // became OBSERVABLE as failed — it just silently stopped appearing to
    // anyone, indistinguishable from "not due yet" to a caller that only
    // checks `stage`. `job.cursor_attempt` here is the count claim_
    // ingestion_job already incremented FOR this attempt (109's claim body:
    // `cursor_attempt = cursor_attempt + 1`), so `>= max_attempts` means
    // this was the last one it was ever going to get.
    if (job.cursor_attempt >= job.max_attempts) {
      // BUG-1 layer 1 (2026-09-14): a single degenerate chunk exhausting
      // its attempts on a CONTENT-shaped failure (the model timed out or
      // returned empty content for THIS chunk) must not fail the whole
      // book — one bad position among 203 good ones. But this must NOT
      // apply to an infrastructure/budget failure (a revoked key, a
      // DeepSeek outage, a spend-cap refusal): those mean every remaining
      // chunk would exhaust identically, and silently skipping all of them
      // would walk the whole book to finalizingStage's "zero lessons"
      // failure over hours while blaming the user's file for our outage.
      // `GatewayCallFailedError` is the ONLY source of this signal — a
      // plain thrown Error (a Supabase error, a genuine code bug) is never
      // eligible, which keeps this narrow by construction: skip is the
      // exception, fail-the-book stays the default.
      const isContentShapedFailure =
        e instanceof GatewayCallFailedError &&
        !e.capBlocked &&
        (e.errorKind === "timeout" || e.errorKind === "empty_content");

      // Only stages with a real cursor_chunk_index have a "position" to
      // skip past — the whole-book stages (queued/extracting_text/
      // parsing_structure/chunking/merging/finalizing, chunk_index null)
      // have no sub-unit smaller than the whole job, so exhaustion there
      // keeps today's fail-the-book behavior unconditionally.
      if (expectedChunkIndex !== null && isContentShapedFailure) {
        const nextChunkIndex = expectedChunkIndex + 1;
        const skipReason = `${expectedStage} (chunk ${expectedChunkIndex}): SKIPPED after exhausting ${job.max_attempts} attempts -- content-shaped failure (${e.errorKind}): ${errorMessage}`;

        const { data: skipped, error: skipError } = await untypedRpc<{
          skipped_positions: number;
          consecutive_skipped_positions: number;
        }>(supabase, "skip_ingestion_cursor_position", {
          p_job_id: job.id,
          p_expected_stage: expectedStage,
          p_expected_chunk_index: expectedChunkIndex,
          p_expected_attempt: expectedAttempt,
          p_next_stage: expectedStage,
          p_next_chunk_index: nextChunkIndex,
          p_skip_reason: skipReason,
        });

        if (skipError) {
          // Couldn't even record the skip -- fall back to the safety net
          // rather than leave the job silently unclaimable forever.
          const failed = await failBook(supabase, {
            jobId: job.id,
            bookId: job.book_id,
            jobErrorMessage: `${skipReason} -- AND skip_ingestion_cursor_position itself failed: ${skipError.message}`,
            bookErrorMessage: "Something went wrong while processing this book. Please try uploading it again.",
          });
          return halt(
            { ok: false, reason: "chunk_skip_failed", stage: expectedStage, chunkIndex: expectedChunkIndex, error: errorMessage, skipError: skipError.message, bookMarkedFailed: failed.ok },
            { status: 500 },
          );
        }

        // null (not a composite-of-nulls -- same PL/pgSQL NULL semantics
        // advance_ingestion_cursor's own `alreadyAdvanced` check relies on)
        // means the position had already moved -- a concurrent/retried
        // caller got here first. The idempotent no-op this design exists
        // to make safe, not a failure to report.
        const alreadySkipped = skipped === null;

        // books.stage/progress_pct sync, same call as a genuine advance
        // makes (see below) -- a skip is still real forward motion the
        // library view must reflect, not a stall.
        if (!alreadySkipped && expectedStage !== "done" && expectedStage !== "failed") {
          await syncBookProgress(supabase, job.book_id, expectedStage, nextChunkIndex);
        }

        // CIRCUIT BREAKER (BUG-1 layer 1's second half): non-determinism
        // cuts both ways -- the same mechanism that makes one bad chunk
        // harmless could just as easily paper over a genuinely degraded
        // provider by skipping every single chunk. 3 consecutive
        // content-shaped exhaustions, or skips crossing a real fraction of
        // positions processed so far, is not "a bad chunk" anymore -- it's
        // reported honestly and immediately rather than let the book walk
        // all the way to finalizingStage's "zero lessons" message hours
        // later. `nextChunkIndex` IS "positions processed so far" (0-based,
        // inclusive of this one) -- no extra query needed.
        const CONSECUTIVE_SKIP_LIMIT = 3;
        const SKIP_RATIO_LIMIT = 0.25;
        // The ratio arm needs a real sample to mean anything: at
        // nextChunkIndex=1 (the very first position), one skip is 100% of
        // "positions processed so far" by construction, not evidence of a
        // pattern. Below this floor, only the consecutive-streak arm can
        // trip the breaker -- exactly what it exists for.
        const MIN_POSITIONS_FOR_RATIO_CHECK = 4;
        const consecutiveSkipped = skipped?.consecutive_skipped_positions ?? 0;
        const totalSkipped = skipped?.skipped_positions ?? 0;
        const ratioTripped = nextChunkIndex >= MIN_POSITIONS_FOR_RATIO_CHECK && totalSkipped / nextChunkIndex > SKIP_RATIO_LIMIT;
        const circuitTripped = !alreadySkipped && (consecutiveSkipped >= CONSECUTIVE_SKIP_LIMIT || ratioTripped);

        if (circuitTripped) {
          const providerReason =
            e.errorKind === "timeout"
              ? "The AI provider kept timing out while processing this book."
              : "The AI provider kept returning empty responses while processing this book.";
          const failed = await failBook(supabase, {
            jobId: job.id,
            bookId: job.book_id,
            jobErrorMessage: `${expectedStage}: circuit breaker tripped after ${totalSkipped} skips (${consecutiveSkipped} consecutive) -- last: ${skipReason}`,
            bookErrorMessage: `${providerReason} Please try again later.`,
          });
          return halt(
            {
              ok: false,
              reason: "circuit_breaker_tripped",
              stage: expectedStage,
              chunkIndex: expectedChunkIndex,
              skippedPositions: totalSkipped,
              consecutiveSkippedPositions: consecutiveSkipped,
              bookMarkedFailed: failed.ok,
            },
            { status: 500 },
          );
        }

        return halt({
          ok: true,
          reason: "chunk_skipped_after_exhausted_attempts",
          stage: expectedStage,
          chunkIndex: expectedChunkIndex,
          nextChunkIndex,
          alreadySkipped,
          errorKind: e.errorKind,
          skippedPositions: totalSkipped,
          consecutiveSkippedPositions: consecutiveSkipped,
        });
      }

      const failed = await failBook(supabase, {
        jobId: job.id,
        bookId: job.book_id,
        jobErrorMessage: `${expectedStage} (chunk ${expectedChunkIndex}): exhausted ${job.max_attempts} attempts -- last error: ${errorMessage}`,
        bookErrorMessage: "Something went wrong while processing this book. Please try uploading it again.",
      });
      if (!failed.ok) {
        return halt(
          { ok: false, reason: "stage_work_failed_and_could_not_mark_failed", stage: expectedStage, chunkIndex: expectedChunkIndex, error: errorMessage, failError: failed.failError },
          { status: 500 },
        );
      }

      return halt(
        { ok: false, reason: "attempts_exhausted", stage: expectedStage, chunkIndex: expectedChunkIndex, maxAttempts: job.max_attempts, error: errorMessage },
        { status: 500 },
      );
    }

    return halt(
      { ok: false, reason: "stage_work_failed", stage: expectedStage, chunkIndex: expectedChunkIndex, error: errorMessage },
      { status: 500 },
    );
  }

  const { data: advanced, error: advanceError } = await supabase.rpc("advance_ingestion_cursor", {
    p_job_id: job.id,
    p_expected_stage: expectedStage,
    // The generated Args type says `number`, not `number | null` — the type
    // generator doesn't mark a plpgsql `int` parameter nullable unless it
    // has `default null`, even though 109's SQL genuinely accepts NULL here
    // (that's the whole-book-stage case). Cast, don't coerce: passing 0 in
    // place of a real null would silently target chunk 0 instead of "no
    // chunk," which is exactly the kind of substitution this project's own
    // NULL-handling incidents (submit_review's soft-delete check, sources'
    // storage-path check) warn against.
    p_expected_chunk_index: expectedChunkIndex as number,
    p_expected_attempt: expectedAttempt,
    p_next_stage: work.nextStage,
    p_next_chunk_index: work.nextChunkIndex as number,
  });
  if (advanceError) {
    // Genuinely unexpected: bracketStage just recorded succeeded=true for
    // this exact position, so advance_ingestion_cursor's own precondition
    // should hold. Surfaced rather than swallowed — this is a different
    // finding than gate 3's own red case (which tests the refusal path
    // deliberately), and a real occurrence here would mean the two are out
    // of sync in a way worth investigating, not retrying quietly.
    return halt({ ok: false, reason: "advance_failed", error: advanceError.message }, { status: 500 });
  }

  // See this file's own header for why this exists: books.stage was
  // otherwise frozen at 'queued' for a book's entire run, and
  // books.progress_pct never moved off 0 until finalizingStage's single
  // terminal write. `done`/`failed` are excluded on purpose —
  // finalizingStage already owns the authoritative write for both, and
  // this sync must never race or clobber it (a "done" advance and this
  // sync could in principle interleave with finalizingStage's own update
  // within the same request only because they're sequential here, not
  // concurrent — but skipping them entirely removes the question rather
  // than relying on ordering). Best-effort: the cursor has already,
  // successfully, durably advanced by this point — a cosmetic sync failure
  // must not turn a real success into a reported one.
  if (work.nextStage !== "done" && work.nextStage !== "failed") {
    await syncBookProgress(supabase, job.book_id, work.nextStage, work.nextChunkIndex);
  }

  return {
    // A cursor that had already moved means another invocation got there first (the idempotent no-op this design exists
    // to make safe): this caller steps aside instead of claiming again.
    kind: advanced === null ? "stopped" : "advanced",
    status: 200,
    body: {
      ok: true,
      jobId: job.id,
      stage: expectedStage,
      chunkIndex: expectedChunkIndex,
      // null from advance_ingestion_cursor means the cursor had already moved
      // (a concurrent or retried caller got here first) — the idempotent
      // no-op this design exists to make safe, reported honestly rather than
      // conflated with "I moved it."
      alreadyAdvanced: advanced === null,
      nextStage: work.nextStage,
      nextChunkIndex: work.nextChunkIndex,
    },
  };
}

export async function POST(request: Request) {
  if (!process.env.SELF_MASTERY_INGESTION_SECRET) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }
  if (!checkIngestionSecret(request)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // Unconditional once auth passes, BEFORE the claim — this call proves
  // "the driver reached this route just now," which must stay true whether
  // or not a job happened to be eligible. See recordIngestionDriverHeartbeat
  // and isIngestionAvailable's own headers. Best-effort by design (returns
  // a bool, never throws) — a heartbeat write failing must never block the
  // real ingestion work this invocation exists to do.
  await recordIngestionDriverHeartbeat(supabase);

  // Housekeeping before the claim: fail books that can never finish (no job, or a job silent for an hour) so the library
  // offers "Try again". Bounded, idempotent and never throws (stuck-sweep.ts); it must not cost the poll its real work.
  await sweepStuckBooks(supabase);

  // One poll now runs MANY steps (claim -> stage -> advance) until the time budget is spent, something other than a clean
  // advance happens, or nothing is left to claim. See step-loop.ts. Each step is the same code, with the same writes, as
  // the old single-shot route, so crash-safety is unchanged: a step is durable once its advance lands.
  const hop = parseHop(request.headers.get(HOP_HEADER));
  const result = await runStepLoop(() => runStep(supabase));
  // Only a 'budget' stop means work remains. Anything else (nothing eligible, a failure, a cursor someone else moved) is
  // never chained, and the 1-minute cron stays the fallback. The kick is a DB-side pg_net POST (migration 273), so this
  // returns at once; see step-chain.ts for the rails (hop cap, kill switch, 20 s rate guard in the RPC).
  const chained = result.stoppedBy === "budget" ? await kickNextHop(supabase, hop) : false;
  return NextResponse.json(
    { ...result.body, loop: { steps: result.steps, elapsedMs: result.elapsedMs, stoppedBy: result.stoppedBy, chained, hop } },
    { status: result.status },
  );
}
