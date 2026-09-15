import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { dispatchSleepReminders } from "@/lib/notifications/sleep-reminder";

/**
 * P2-05's poll target -- meant to be hit by the SAME
 * `dispatch-notifications-every-15min` pg_cron+pg_net job that already
 * drives #10's own `app/api/cron/daily-due-card/route.ts` and P2-02's
 * `app/api/cron/nightly-morning-brief/route.ts` (a third `net.http_post`
 * inside that job's own `cron.job` command, not a new parallel schedule --
 * INSTRUCTIONS.md §6/§11's "cron wired consistently with existing jobs").
 * That registration is operator state, not a migration, so it's the
 * Lead's to apply.
 *
 * Auth idiom copied byte-for-byte from the other two cron routes above --
 * the SAME `CRON_SECRET`, no new secret needed. Fails closed (503) if the
 * secret is unset.
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
  const result = await dispatchSleepReminders(serviceClient, new Date());
  return NextResponse.json({ success: true, at: new Date().toISOString(), ...result });
}
