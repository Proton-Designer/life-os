import { NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { syncCanvasAnnouncementsCore, syncCanvasGradesCore } from "@/lib/canvas/sync-core";
import { reconcileDueIcsFeeds } from "@/lib/canvas/ics-auto-reconcile";

/**
 * P2-21 poll target. Auth idiom copied byte-for-byte from
 * app/api/cron/lecture-transcription/route.ts (itself copied from ping/
 * scheduled-actions) -- the SAME `CRON_SECRET`, no new secret needed (no
 * separate "mcp_cron_secret" exists anywhere in this codebase — grepped
 * every cron route, all of them read `CRON_SECRET`). Fails closed (503) if
 * the secret is unset.
 *
 * BACKGROUNDED VIA after(), same reasoning as lecture-transcription's own
 * header: this route is meant to sit behind pg_net (Opus Lead to register
 * into job 1, per the Lead's own instruction), whose HTTP client times out
 * around 5s, and N users x M courses x 2 Canvas endpoints can genuinely
 * exceed that. The handler authenticates, schedules the sync via after(),
 * and returns 202 immediately; the outcome can't ride the (already-sent)
 * response, so it's console.log'd (visible in Vercel's function logs), same
 * as lecture-transcription's own posture.
 *
 * PER-RUN CAP (Opus Lead ruling: "has a per-user cap per run"):
 * MAX_USERS_PER_RUN bounds how many accounts get synced in ONE invocation,
 * same reasoning mcp-scheduled-actions' own "per tick claim is already
 * <=25 rows" convention gives -- a bounded, predictable invocation cost
 * regardless of how many total accounts have Canvas connected, at the cost
 * of throughput for an account fleet larger than that (a real future lever
 * — a smarter "who hasn't synced recently" ordering — not built
 * speculatively here).
 *
 * ONLY users with token_status='ok' AND at least one mapped course are
 * selected -- an expired connection has nothing this poll can fix (P2-22's
 * expiry path already told the user to reconnect; re-attempting and
 * re-failing every poll tick is wasted work and noise), and a connection
 * with zero mapped courses has nothing to sync.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 280;

const MAX_USERS_PER_RUN = 25;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface EligibleUser {
  userId: string;
  timezone: string;
}

async function getEligibleUsers(supabase: ReturnType<typeof createServiceRoleClient>): Promise<EligibleUser[]> {
  const { data: connections, error } = await supabase.from("canvas_connections").select("user_id").eq("token_status", "ok").limit(MAX_USERS_PER_RUN);
  if (error) throw error;
  if (!connections || connections.length === 0) return [];

  const userIds = connections.map((c) => c.user_id as string);
  const { data: mappings, error: mappingsError } = await supabase.from("canvas_course_mappings").select("user_id").in("user_id", userIds).not("class_id", "is", null);
  if (mappingsError) throw mappingsError;
  const mappedUserIds = new Set((mappings ?? []).map((m) => m.user_id as string));
  if (mappedUserIds.size === 0) return [];

  const { data: profiles, error: profilesError } = await supabase.from("profiles").select("user_id, timezone").in("user_id", Array.from(mappedUserIds));
  if (profilesError) throw profilesError;

  return (profiles ?? []).map((p) => ({ userId: p.user_id as string, timezone: (p.timezone as string | null) ?? "UTC" }));
}

async function runSync(): Promise<{ users: number; announcementsStaged: number; gradesUpdated: number; assignmentsStaged: number; ics: { checked: number; reconciled: number; failed: number; newlyStaged: number } }> {
  const supabase = createServiceRoleClient();
  const users = await getEligibleUsers(supabase);
  const now = new Date();

  let announcementsStaged = 0;
  let gradesUpdated = 0;
  let assignmentsStaged = 0;

  for (const user of users) {
    const announcementResult = await syncCanvasAnnouncementsCore(supabase, user.userId, user.timezone, now);
    if (announcementResult.ok) announcementsStaged += announcementResult.staged;

    const gradeResult = await syncCanvasGradesCore(supabase, user.userId, user.timezone, now);
    if (gradeResult.ok) {
      gradesUpdated += gradeResult.graded;
      assignmentsStaged += gradeResult.staged;
    }
  }

  // Calendar-feed (ICS) users: some schools block Canvas tokens, so the feed is the only path and the token sync above never sees them.
  // Each connected feed is checked at most every 6 hours, with a per-run cap (lib/canvas/ics-auto-reconcile.ts). Its failure must not
  // cost the token sync its result, so it is caught here.
  let ics = { checked: 0, reconciled: 0, failed: 0, newlyStaged: 0 };
  try {
    ics = await reconcileDueIcsFeeds(supabase, now);
  } catch (err) {
    console.error("[canvas-sync] ICS pass failed", err);
  }

  return { users: users.length, announcementsStaged, gradesUpdated, assignmentsStaged, ics };
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

  after(async () => {
    try {
      const result = await runSync();
      console.log(`[canvas-sync] ${new Date().toISOString()}`, result);
    } catch (err) {
      console.error("[canvas-sync] unhandled error", err);
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
