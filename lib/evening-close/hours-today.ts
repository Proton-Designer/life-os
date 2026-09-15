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

/** Minutes per `work_sessions.kind`, restricted to the counting kinds ('deep_work' / 'deep_study' / 'exam_prep' — whatever of those actually occurred in the range). Never 'learn': see getHoursByKindForRange's own comment for why. */
export type HoursByKind = Record<string, number>;

/**
 * #46's Weekly Review "Total Hours + by-category" — CORRECTED 2026-09-15
 * (Opus Lead's own correction of the 2026-09-14 ruling, found by browser-
 * verifying production: a single abandoned 247-minute 'learn' session made
 * "Hours 4:07" read as almost entirely retrieval review, not deep work).
 *
 * The original ruling asked for two things that turn out to contradict
 * each other: "Hours" must mean the same thing it does everywhere else in
 * the ritual layer (`counts_toward_hours = true` — `getHoursTodayMinutes`
 * above, "Hours today" on /close and /open/today, the Efficiency metric),
 * AND the bars must include 'learn'. `counts_toward_hours` resolves to
 * `false` for 'learn' BY CONSTRUCTION (migrations 057/077) — there is no
 * way to satisfy both at once, and the first version of this function
 * resolved it by dropping the filter, which is exactly the disagreement
 * the ruling was written to prevent.
 *
 * This version keeps the filter (same day-bound discipline as
 * `getHoursTodayMinutes`: the caller passes already-`resolveLocalTime`-
 * derived instants, never a raw `${date}T00:00:00Z` slice) and the bars
 * are only ever the kinds that filter admits — `totalMinutes` is still
 * exactly the sum of every `byKind` entry, so the headline and the bars
 * still reconcile by construction. 'learn' time is a SEPARATE concern —
 * see `getEndedRecallMinutesForRange` below — never folded back in here.
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
    .eq("counts_toward_hours", true)
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

/**
 * #46's separate "Recall" (retrieval review) line — shown OUTSIDE the
 * Hours headline, per the correction above, never summed into it.
 *
 * ENDED SESSIONS ONLY (`ended_at IS NOT NULL`) — the specific, live data-
 * quality problem the correction named: abandoning a review mid-way never
 * closes its `work_sessions` row (production had 8 open 'learn' sessions
 * at correction time, one 4+ hours old), so an open session is EXCLUDED
 * outright rather than capped or counted-to-`now`. A still-running review
 * simply isn't finished reviewing yet; it has no honest duration to report
 * here until it is. This is also why the duration math here does NOT reuse
 * `computeFocusTimeMinutes` (which treats a null `ended_at` as "running
 * until `now`", the exact behavior this function must not have for
 * 'learn') — the query itself filters those rows out before any duration
 * is computed.
 */
export async function getEndedRecallMinutesForRange(
  supabase: SupabaseClient,
  userId: string,
  startIso: string,
  endIso: string
): Promise<number> {
  const { data } = await supabase
    .from("work_sessions")
    .select("started_at, ended_at")
    .eq("user_id", userId)
    .eq("kind", "learn")
    .not("ended_at", "is", null)
    .gte("started_at", startIso)
    .lt("started_at", endIso);

  return (data ?? []).reduce((total, row) => {
    const startedAt = new Date(row.started_at as string).getTime();
    const endedAt = new Date(row.ended_at as string).getTime();
    return total + (endedAt - startedAt) / 60_000;
  }, 0);
}
