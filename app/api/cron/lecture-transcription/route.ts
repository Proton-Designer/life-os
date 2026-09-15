import { NextResponse } from "next/server";
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
 * Registering this into pg_cron (a NEW schedule, or a second net.http_post
 * added to an existing one) is the lead's operator-state work, same as
 * daily-due-card's own header notes -- not this route's concern.
 */
export const dynamic = "force-dynamic";

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

  const serviceClient = createServiceRoleClient();
  const result = await processOneTranscriptionJob(serviceClient);
  return NextResponse.json({ success: true, at: new Date().toISOString(), result });
}
