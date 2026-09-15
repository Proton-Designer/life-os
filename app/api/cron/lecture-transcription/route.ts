import { NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { processOneTranscriptionJob } from "@/lib/school/lecture-transcription-worker";

/**
 * P3-15 poll target. Auth idiom copied byte-for-byte from
 * app/api/cron/daily-due-card/route.ts (itself copied from ping/
 * scheduled-actions) -- the SAME CRON_SECRET, no new secret needed. Fails
 * closed (503) if the secret is unset, same reasoning those routes give: a
 * route that answered 200 to everyone would prove reachability while
 * proving nothing about auth.
 *
 * Processes exactly ONE job per invocation -- bounded, predictable
 * execution time regardless of how long a real transcription call takes, at
 * the cost of throughput (roughly one recording transcribed per cron tick).
 * A deliberate scope limit (see this task's own Plan section), not a bug --
 * widening this to a small batch is a one-line change (a loop around
 * processOneTranscriptionJob until it returns {processed:false} or a time
 * budget is spent) if a future pass needs more throughput.
 *
 * BACKGROUNDED VIA after() (tracking-app-a9 + Opus Lead review): this route
 * is invoked by pg_net (jobid 1, dispatch-notifications-every-15min), whose
 * own HTTP client times out around 5s. A real transcription call can take
 * far longer than that, so the actual work must never happen inline before
 * the response -- it would look like a timeout from pg_net's side and risks
 * the connection (and the function) being torn down mid-job. Instead: this
 * handler authenticates, schedules the job via `after()`, and returns 202
 * immediately. `after()` then runs `processOneTranscriptionJob` within this
 * route's own `maxDuration` (below), independent of pg_net's response wait.
 * The job's outcome can't ride the (already-sent) response, so it's
 * console.log'd instead -- visible in Vercel's function logs.
 *
 * `maxDuration = 280`: the real ceiling `processOneTranscriptionJob`
 * budgets Gemini's own generateContent timeout against (see
 * lib/school/lecture-transcription-worker.ts's FUNCTION_MAX_DURATION_MS,
 * which MUST match this number) -- comfortably under Vercel's own hard
 * function limit, leaving room for our own abort to fire and write a clean
 * 'failed' status before Vercel kills the invocation outright.
 *
 * Registering this into pg_cron (a NEW schedule, or a second net.http_post
 * added to an existing one) is the lead's operator-state work, same as
 * daily-due-card's own header notes -- not this route's concern.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 280;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!timingSafeEqual(token, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Scheduled, NOT awaited -- the response below is what pg_net actually
  // waits on, and it must return well inside its ~5s timeout. after()'s own
  // callback runs post-response, budgeted by this route's `maxDuration`.
  after(async () => {
    try {
      const serviceClient = createServiceRoleClient();
      const result = await processOneTranscriptionJob(serviceClient);
      console.log(`[lecture-transcription] ${new Date().toISOString()}`, result);
    } catch (err) {
      console.error(`[lecture-transcription] unhandled error`, err);
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
