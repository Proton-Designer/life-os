import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { dispatchCollegeOsWeeklyNarratives } from "@/lib/weekly-review/weekly-narrative";
import { dispatchUlmWeeklyRecaps } from "@/lib/self-mastery/weekly-retention-recap";

/**
 * P2-03's poll target -- meant to be hit by the SAME
 * `dispatch-notifications-every-15min` pg_cron+pg_net job that already
 * drives #10's daily-due-card, P2-02's nightly-morning-brief, and P2-05's
 * sleep-reminder routes (a fourth `net.http_post` inside that job's own
 * `cron.job` command, not a new parallel schedule -- INSTRUCTIONS.md
 * §6/§11's "cron wired consistently with existing jobs"). That
 * registration is operator state, not a migration, so it's the Lead's to
 * apply.
 *
 * Runs BOTH weekly-synthesis dispatchers behind one auth check, same
 * piggyback shape this track's own P2-04 used for the Hour-completion
 * poll on the scheduled-actions route: each dispatcher internally gates
 * on "is it this user's own local Sunday, inside the generation window,"
 * so hitting this route on every 15-minute tick (most of which do nothing
 * for any given user) is cheap and correct.
 *
 * Auth idiom copied byte-for-byte from the other cron routes above -- the
 * SAME `CRON_SECRET`, no new secret needed. Fails closed (503) if the
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
  const now = new Date();
  const narratives = await dispatchCollegeOsWeeklyNarratives(serviceClient, now);
  const recaps = await dispatchUlmWeeklyRecaps(serviceClient, now);
  return NextResponse.json({ success: true, at: now.toISOString(), narratives, recaps });
}
