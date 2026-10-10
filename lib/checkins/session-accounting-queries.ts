import { createClient } from "@/lib/supabase/server";
import { sessionDomainForKind, type SessionRange } from "./session-accounting";

/**
 * Shared Supabase queries behind session auto-accounting (session-accounting.ts) -- used identically by sn-ratio.ts
 * and focus-map.ts so the two range-bound query shapes cannot drift apart.
 */

/** Every stored allocation check-in's own [window_start, window_end) span in range. */
export async function getStoredAllocationSpans(userId: string, startIso: string, endIso: string): Promise<{ start: Date; end: Date }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("checkins")
    .select("window_start, window_end")
    .eq("user_id", userId)
    .eq("kind", "allocation")
    .gte("window_start", startIso)
    .lt("window_start", endIso);
  return (data ?? [])
    .filter((r): r is { window_start: string; window_end: string } => r.window_start !== null && r.window_end !== null)
    .map((r) => ({ start: new Date(r.window_start), end: new Date(r.window_end) }));
}

/** Sessions OVERLAPPING the range (not just started inside it), each with the domain its kind is credited to. */
export async function getSessionRanges(userId: string, startIso: string, endIso: string): Promise<SessionRange[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("work_sessions")
    .select("kind, started_at, ended_at")
    .eq("user_id", userId)
    .eq("counts_toward_hours", true) // see migration 057
    .lt("started_at", endIso)
    .or(`ended_at.is.null,ended_at.gte.${startIso}`);
  return (data ?? []).map((s) => ({
    start: new Date(s.started_at),
    end: s.ended_at ? new Date(s.ended_at) : null,
    domain: sessionDomainForKind(s.kind),
  }));
}
