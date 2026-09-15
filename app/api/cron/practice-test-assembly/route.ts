import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { dispatchPracticeTestAssembly } from "@/lib/school/practice-test";

/**
 * P2-09's poll target -- same 15-minute pg_cron+pg_net heartbeat as
 * #10/P2-02/P2-05's own cron routes (another net.http_post on the same
 * job, not a new schedule -- INSTRUCTIONS.md's "cron wired consistently
 * with existing jobs"). That registration is operator state, not a
 * migration, so it's the Lead's to apply.
 *
 * Auth idiom copied byte-for-byte from the other cron routes tonight --
 * the SAME CRON_SECRET, no new secret needed. Fails closed (503) if unset.
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
  const result = await dispatchPracticeTestAssembly(serviceClient, new Date());
  return NextResponse.json({ success: true, at: new Date().toISOString(), ...result });
}
