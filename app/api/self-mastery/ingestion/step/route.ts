import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { bracketStage } from "@/lib/self-mastery/ingestion/telemetry";
import { STAGE_HANDLERS } from "@/lib/self-mastery/ingestion/worker-stages";

/**
 * A5 gates 3-4: one ingestion chunk per invocation, driven by whatever
 * calls this route (a driver is explicitly NOT built here — item 6 in the
 * track plan is blocked on the LifeOS lead's authenticated pg_net->route
 * round-trip proof; this handler is built so a driver CAN call it, not
 * wired to one). Reads `ingestion_jobs`' cursor position via
 * `claim_ingestion_job`, does exactly the one stage/chunk's work, and
 * advances via `advance_ingestion_cursor` — never routes around it.
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

  const { data: job, error: claimError } = await supabase.rpc("claim_ingestion_job");
  if (claimError) {
    return NextResponse.json({ ok: false, reason: "claim_failed", error: claimError.message }, { status: 500 });
  }
  if (!job) {
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
    const errorMessage = e instanceof Error ? e.message : String(e);

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
