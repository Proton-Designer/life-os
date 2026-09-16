import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeDeltaMinutes } from "./delta-clock";
import { computeEfficiency } from "./efficiency";

/**
 * P3-09: the evening-close ritual's own idempotent completion mark.
 * Mirrors `markDayStarted` (lib/day-structure/day-start.ts) exactly: a
 * second Finish tap on the same local date must not move `closed_at`, so
 * this upserts with `ignoreDuplicates: true` (PostgREST's `INSERT ... ON
 * CONFLICT (user_id, local_date) DO NOTHING`) against 199_evening_closes.sql's
 * `unique (user_id, local_date)` constraint, rather than a plain `.insert()`
 * (throws 23505 on a second Finish) or a plain `.upsert()` without
 * `ignoreDuplicates` (would silently move the mark forward on every replan).
 *
 * `localDate` must already be `localDateString(now, timezone)` from the
 * caller — never derived here from a raw `Date`, same rule every other
 * "which day is this for" write in this codebase follows.
 */
export async function recordEveningCloseCore(supabase: SupabaseClient, userId: string, localDate: string, now: Date): Promise<void> {
  const { error } = await supabase
    .from("evening_closes")
    .upsert({ user_id: userId, local_date: localDate, closed_at: now.toISOString() }, { onConflict: "user_id,local_date", ignoreDuplicates: true });
  if (error) throw error;
}

/** Close marks for every `local_date` in `[startDate, endDateExclusive)` — the range-query twin of `getDayStartsForRange` (lib/day-structure/day-start.ts), same keyed-by-local_date shape. */
export async function getEveningClosesForRange(
  supabase: SupabaseClient,
  userId: string,
  startDate: string,
  endDateExclusive: string
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("evening_closes")
    .select("local_date, closed_at")
    .eq("user_id", userId)
    .gte("local_date", startDate)
    .lt("local_date", endDateExclusive);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.local_date as string, row.closed_at as string]));
}

export interface DayForEfficiencySplit {
  localDate: string;
  hoursMinutes: number;
  /** `day_starts.woke_at` for this date, or null if the day was never started. */
  wokeAtIso: string | null;
  /** `evening_closes.closed_at` for this date, or null if the day was never closed. */
  closedAtIso: string | null;
}

export interface EfficiencyByClosedDay {
  /** Average of each closed day's own efficiency.percent, or null if no day in range produced one. */
  closedAvgPercent: number | null;
  closedCount: number;
  /** Started but never closed — no honest end-of-day anchor exists for these (see this module's own header), so they are counted, never given a fabricated percent. */
  openCount: number;
}

/**
 * Pure, unit-testable bucketing — no DB access, no `Date.now()`.
 *
 * A day counts as CLOSED only with BOTH a wake mark and a close mark: that
 * pair gives a real, bounded delta (`computeDeltaMinutes(wokeAt, closedAt)`)
 * to divide hours by. A day counts as OPEN only with a wake mark and NO
 * close mark — engaged with, never finished. A day with neither mark is
 * out of scope for this split entirely (nothing in Day Structure's ritual
 * layer happened that day), not silently folded into "open."
 *
 * WHY OPEN DAYS GET NO FABRICATED PERCENT (P3-09, Opus Lead's own check
 * before approving this): the existing Efficiency metric's only other
 * denominator, for a day "still in progress," is live wall-clock `now`
 * (app/(app)/open/today/page.tsx, app/(app)/close/actions.ts — both call
 * `computeDeltaMinutes(wokeAtIso, new Date())`). That instant is only
 * meaningful because today is actually still happening; it has no honest
 * analog for a PAST day that was never closed. Reusing `computeEfficiency`
 * here rather than reinventing it means a closed day with a non-positive
 * delta (closed_at before woke_at — should never happen, but not asserted
 * away) is excluded from the average the same way `computeEfficiency`
 * already treats "no meaningful denominator" everywhere else: null, not 0%.
 */
export function bucketEfficiencyByClosedDay(days: readonly DayForEfficiencySplit[]): EfficiencyByClosedDay {
  const closedPercents: number[] = [];
  let openCount = 0;
  for (const day of days) {
    if (day.wokeAtIso === null) continue;
    if (day.closedAtIso === null) {
      openCount++;
      continue;
    }
    const deltaMinutes = computeDeltaMinutes(day.wokeAtIso, new Date(day.closedAtIso));
    const efficiency = computeEfficiency(day.hoursMinutes, deltaMinutes);
    if (efficiency !== null) closedPercents.push(efficiency.percent);
  }
  const closedAvgPercent = closedPercents.length === 0 ? null : Math.round(closedPercents.reduce((a, b) => a + b, 0) / closedPercents.length);
  return { closedAvgPercent, closedCount: closedPercents.length, openCount };
}
