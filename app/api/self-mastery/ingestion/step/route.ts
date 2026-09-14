import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { bracketStage, describeError } from "@/lib/self-mastery/ingestion/telemetry";
import { STAGE_HANDLERS } from "@/lib/self-mastery/ingestion/worker-stages";
import { recordIngestionDriverHeartbeat } from "@/lib/self-mastery/ingestion-availability";
import { estimateBookProgressPct } from "@/lib/self-mastery/ingestion-progress";
import { untypedFrom } from "@/lib/self-mastery/untyped-from";

/**
 * A5 gates 3-4, plus S6's driver wiring (2026-09-14): one ingestion chunk
 * per invocation, driven by a pg_cron + pg_net poll (the same idiom as
 * `mcp-scheduled-actions`, jobid 2 — see the build report for the exact SQL
 * and the recommended cadence). Reads `ingestion_jobs`' cursor position via
 * `claim_ingestion_job`, does exactly the one stage/chunk's work, and
 * advances via `advance_ingestion_cursor` — never routes around it.
 *
 * STILL ONE STAGE PER INVOCATION, NOT LOOPED — a deliberate choice, not an
 * oversight. Looping several stages per call (to shorten a real book's
 * multi-hour run) was drafted and then backed out: this route's control
 * flow is exactly what nine of its own tests (route.test.ts) pin down call
 *-by-call, including two that assert an EXACT count of `.update()` calls
 * per invocation (Gate 5's pair) — a real driver loop needs those tests
 * restructured around a stateful mock that tracks cursor position across
 * iterations, which is a bigger, riskier change than this pass's actual
 * blocker (there was no consumer at all) warranted. Flagged as the next
 * throughput lever in the build report, not silently dropped.
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

  const { data: job, error: claimError } = await supabase.rpc("claim_ingestion_job");
  if (claimError) {
    return NextResponse.json({ ok: false, reason: "claim_failed", error: claimError.message }, { status: 500 });
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
    return NextResponse.json({ ok: true, reason: "no_eligible_job" }, { status: 200 });
  }

  const handler = STAGE_HANDLERS[job.stage];
  if (!handler) {
    // Named, not swallowed: an unimplemented stage is a 501, not a silent
    // 200 that would look identical to real progress from the outside.
    return NextResponse.json(
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
      const { error: failError } = await supabase
        .from("ingestion_jobs")
        .update({ stage: "failed", last_error: `${expectedStage} (chunk ${expectedChunkIndex}): exhausted ${job.max_attempts} attempts -- last error: ${errorMessage}` })
        .eq("id", job.id);
      if (failError) {
        return NextResponse.json(
          { ok: false, reason: "stage_work_failed_and_could_not_mark_failed", stage: expectedStage, chunkIndex: expectedChunkIndex, error: errorMessage, failError: failError.message },
          { status: 500 },
        );
      }

      // THE BUG THIS CLOSES (S6, 2026-09-14, found live): this branch has
      // always marked `ingestion_jobs.stage = 'failed'` — observable to
      // anyone reading THAT table — but never touched `books.status` at
      // all. Every reader a user's own UI actually goes through
      // (get-library.ts, get-in-progress-books.ts, get-book-detail.ts)
      // selects `books.status`/`books.stage`, never `ingestion_jobs`
      // directly, so a book whose job exhausted its attempts mid-pipeline
      // stayed at `status: 'processing'` FOREVER from the user's point of
      // view — the exact "stuck at processing forever" failure this whole
      // track exists to close, just reached by a different door than the
      // "nothing consumes the queue" door. Best-effort: if THIS write also
      // fails, the ingestion_jobs-level failure (already recorded above,
      // and already returned to the caller as a 500) still stands — a
      // cosmetic sync failing must not be reported as though the real
      // failure-recording failed too.
      const { error: bookFailError } = await untypedFrom(supabase, "books")
        .update({ status: "failed", error_message: "Something went wrong while processing this book. Please try uploading it again." })
        .eq("id", job.book_id);
      if (bookFailError) {
        console.error("[self-mastery ingestion] failed to sync books.status='failed' after exhausted attempts", bookFailError.message);
      }

      return NextResponse.json(
        { ok: false, reason: "attempts_exhausted", stage: expectedStage, chunkIndex: expectedChunkIndex, maxAttempts: job.max_attempts, error: errorMessage },
        { status: 500 },
      );
    }

    return NextResponse.json(
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
    return NextResponse.json({ ok: false, reason: "advance_failed", error: advanceError.message }, { status: 500 });
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
    const bookUpdate: Record<string, unknown> = { stage: work.nextStage };
    const nextProgressPct = estimateBookProgressPct(work.nextStage, work.nextChunkIndex);
    if (nextProgressPct !== null) bookUpdate.progress_pct = nextProgressPct;

    const { error: bookSyncError } = await untypedFrom(supabase, "books").update(bookUpdate).eq("id", job.book_id);
    if (bookSyncError) {
      console.error("[self-mastery ingestion] failed to sync books.stage/progress_pct after advance", bookSyncError.message);
    }
  }

  return NextResponse.json({
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
  });
}
