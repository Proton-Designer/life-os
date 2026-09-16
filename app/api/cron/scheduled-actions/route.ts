import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { processScheduledActions } from "@/lib/mcp/scheduler-runner";
import { processHourCompletions } from "@/lib/business/hour-completion";
import { processWebhookDeliveries } from "@/lib/mcp/webhook-dispatch";

/**
 * L7's poll target — hit by a pg_cron + pg_net job every 5 minutes (the
 * exact operator-action SQL is recorded in the L7 migration draft's own
 * footer, not run by this file or by me; production applies/operator
 * actions are the lead's per this repo's own convention). Copies
 * app/api/cron/ping/route.ts's proven auth idiom byte-for-byte — reuses
 * the SAME `CRON_SECRET` that route already reads, no new secret needed.
 *
 * Auth is a shared secret in a header, compared in constant time, per
 * ping/route.ts's own reasoning: a route that answered 200 to everyone
 * would prove reachability while proving nothing about auth, and the
 * negative case (wrong secret -> 401) is the half that makes the positive
 * case mean anything.
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
    // Fail closed: an unset secret must not make the route public.
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!timingSafeEqual(token, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const serviceClient = createServiceRoleClient();
  const result = await processScheduledActions(serviceClient);
  // Piggybacked, not a separate cron registration -- see hour-completion.ts's
  // own header for why the existing 5-minute poll is the right home for this.
  const hourCompletions = await processHourCompletions(serviceClient);
  // P4-22: outbound webhook delivery, same piggyback reasoning.
  const webhookDeliveries = await processWebhookDeliveries(serviceClient);
  return NextResponse.json({ success: true, at: new Date().toISOString(), ...result, hourCompletions, webhookDeliveries });
}
