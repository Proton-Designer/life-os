import { createClient } from "@/lib/supabase/server";

/**
 * Shared Supabase queries behind the missed-hour-as-wasted derivation
 * (docs/superpowers/specs/2026-08-19-missed-lockin-hours.md) — used
 * identically by sn-ratio.ts and focus-map.ts, the two range-scoped
 * historical readers acceptance criterion 1 names. Kept in one place so
 * the two range-bound query shapes (spans, sessions-with-stored-hours)
 * can't drift apart between the two call sites.
 */

export async function getStoredAllocationSpans(
  userId: string,
  startIso: string,
  endIso: string
): Promise<{ start: Date; end: Date }[]> {
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

export async function getSessionsWithStoredHours(
  userId: string,
  startIso: string,
  endIso: string
): Promise<{ startedAt: Date; endedAt: Date | null; storedHours: { hourStartIso: string; domain: "business" | "wasted" }[] }[]> {
  const supabase = await createClient();
  // Sessions OVERLAPPING the range, not just started inside it — a session
  // that started before rangeStart and is still open (or ended inside the
  // range) can still have missed hours that fall in range.
  const { data: sessions } = await supabase
    .from("work_sessions")
    .select("id, started_at, ended_at")
    .eq("user_id", userId)
    .lt("started_at", endIso)
    .or(`ended_at.is.null,ended_at.gte.${startIso}`);
  const rows = sessions ?? [];
  if (rows.length === 0) return [];

  const { data: storedHourRows } = await supabase
    .from("checkins")
    .select("window_start, work_session_id, checkin_allocations(domain)")
    .eq("user_id", userId)
    .eq("kind", "allocation")
    .eq("answered", true)
    .in(
      "work_session_id",
      rows.map((s) => s.id)
    );
  const storedBySession = new Map<string, { hourStartIso: string; domain: "business" | "wasted" }[]>();
  for (const r of storedHourRows ?? []) {
    if (!r.window_start || !r.work_session_id || (r.checkin_allocations ?? []).length === 0) continue;
    const list = storedBySession.get(r.work_session_id) ?? [];
    list.push({ hourStartIso: r.window_start, domain: r.checkin_allocations[0].domain as "business" | "wasted" });
    storedBySession.set(r.work_session_id, list);
  }

  return rows.map((s) => ({
    startedAt: new Date(s.started_at),
    endedAt: s.ended_at ? new Date(s.ended_at) : null,
    storedHours: storedBySession.get(s.id) ?? [],
  }));
}
