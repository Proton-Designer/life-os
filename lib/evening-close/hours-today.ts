import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveLocalTime } from "@/lib/date-utils";
import { computeFocusTimeMinutes } from "@/lib/business/focus-time";

/**
 * Minutes of today's deep-work-class sessions (R58) — the SHARED query the
 * evening close (getEveningCloseData, app/(app)/close/actions.ts) and Day
 * Structure's efficiency metric (#35, the Merged Today surface) both read.
 * Extracted out of close/actions.ts rather than duplicated: two independent
 * copies of "filter on the generated counts_toward_hours column, day-bound
 * via resolveLocalTime, sum with computeFocusTimeMinutes" is exactly the
 * kind of drift AGENTS.md warns about — one call site gets a day-bounds fix
 * later and the other quietly doesn't, and the two screens disagree about
 * how many hours today had.
 *
 * `today` and `timezone` are the caller's already-resolved values (typically
 * localDateString(now, timezone)) — this function does not derive "today"
 * itself, so it carries no timezone risk of its own; day bounds come from
 * `resolveLocalTime(today, "00:00"/"23:59", timezone)`, never
 * `${today}T00:00:00Z`, which would treat an already-local date as a UTC
 * boundary and pull in the previous evening (shipped twice here before).
 */
export async function getHoursTodayMinutes(
  supabase: SupabaseClient,
  userId: string,
  today: string,
  timezone: string,
  now: Date
): Promise<number> {
  const dayStart = resolveLocalTime(today, "00:00", timezone).toISOString();
  const dayEnd = resolveLocalTime(today, "23:59", timezone).toISOString();

  const { data } = await supabase
    .from("work_sessions")
    .select("started_at, ended_at")
    .eq("user_id", userId)
    .eq("counts_toward_hours", true)
    .gte("started_at", dayStart)
    .lt("started_at", dayEnd);

  return computeFocusTimeMinutes(
    (data ?? []).map((s) => ({
      startedAt: new Date(s.started_at as string),
      endedAt: s.ended_at ? new Date(s.ended_at as string) : null,
    })),
    now
  );
}

/** Minutes per `work_sessions.kind` ('deep_work' / 'deep_study' / 'learn' / ...), whatever kinds actually occurred in the range. */
export type HoursByKind = Record<string, number>;

/**
 * #46's Weekly Review "Total Hours + by-category" (ruled 2026-09-14: reuse
 * `work_sessions`, not `checkin_allocations`/`getFocusMap` — "Hours"
 * everywhere else in the ritual layer means timed Lock-In sessions, so a
 * Weekly Review number built on self-reported check-in time would disagree
 * with "Hours today" on /close and /open/today under the same word).
 *
 * Extends `getHoursTodayMinutes` above to an arbitrary `[startIso, endIso)`
 * range and breaks it down by `kind` — same duration math
 * (`computeFocusTimeMinutes`), same day-bound discipline (the caller passes
 * already-`resolveLocalTime`-derived instants, never a raw `${date}T00:00:00Z`
 * slice), extended rather than duplicated, per the ruling's own instruction.
 *
 * DELIBERATELY NOT `counts_toward_hours`-filtered, unlike
 * `getHoursTodayMinutes`: the ruling names deep_work/deep_study/learn as the
 * three bar categories, and `'learn'` (retrieval review) resolves
 * `counts_toward_hours` to `false` by construction (migrations 057/077) —
 * filtering on it here would silently drop the `'learn'` bar the ruling
 * asked for. `totalMinutes` is the sum of every `byKind` entry, so the
 * Weekly Review's headline and the bars underneath it reconcile by
 * construction, not by coincidence.
 */
export async function getHoursByKindForRange(
  supabase: SupabaseClient,
  userId: string,
  startIso: string,
  endIso: string,
  now: Date
): Promise<{ totalMinutes: number; byKind: HoursByKind }> {
  const { data } = await supabase
    .from("work_sessions")
    .select("started_at, ended_at, kind")
    .eq("user_id", userId)
    .gte("started_at", startIso)
    .lt("started_at", endIso);

  const byKind: HoursByKind = {};
  for (const row of (data ?? []) as { started_at: string; ended_at: string | null; kind: string }[]) {
    const minutes = computeFocusTimeMinutes(
      [{ startedAt: new Date(row.started_at), endedAt: row.ended_at ? new Date(row.ended_at) : null }],
      now
    );
    byKind[row.kind] = (byKind[row.kind] ?? 0) + minutes;
  }

  const totalMinutes = Object.values(byKind).reduce((a, b) => a + b, 0);
  return { totalMinutes, byKind };
}
