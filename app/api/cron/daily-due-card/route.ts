import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { dispatchDueCardNotifications } from "@/lib/notifications/due-card-notification";

/**
 * #10's poll target — meant to be hit by the SAME `dispatch-notifications-
 * every-15min` pg_cron+pg_net job that already drives
 * `supabase/functions/dispatch-notifications` (jobid 1), as a SECOND
 * `net.http_post` in that job's own command, not a new parallel cron
 * schedule (Opus Lead's explicit instruction). That registration is
 * operator state against the `cron.job` row, not a migration (see
 * migration 166's own comment on why `cron.schedule()` calls live outside
 * `supabase/migrations/`), so it's the lead's to apply.
 *
 * Auth idiom copied byte-for-byte from app/api/cron/ping/route.ts and
 * app/api/cron/scheduled-actions/route.ts — the SAME `CRON_SECRET`, no new
 * secret needed. Fails closed (503) if the secret is unset, same reasoning
 * both of those routes already give: a route that answered 200 to everyone
 * would prove reachability while proving nothing about auth.
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
  const result = await dispatchDueCardNotifications(serviceClient, new Date());
  return NextResponse.json({ success: true, at: new Date().toISOString(), ...result });
}
