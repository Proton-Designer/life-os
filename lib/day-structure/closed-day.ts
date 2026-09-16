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
 * A day counts as CLOSED whenever it has a close mark, period — `closedCount`
 * means "the evening-close ritual ran this day," matching the Weekly Review
 * line's own literal wording ("N closed days"), never "N days that happened
 * to produce a usable percent." A day counts as OPEN only with a wake mark
 * and NO close mark — engaged with, never finished. A day with neither mark
 * is out of scope for this split entirely (nothing in Day Structure's ritual
 * layer happened that day), not silently folded into "open."
 *
 * GAP-03 (ENG3's DAYCLOSE-DFT2 pass, found live the night P3-09 shipped): the
 * evening-close ritual has no gate requiring a same-day Start Day tap first
 * — it is reachable at any time — so a real `evening_closes` row with no
 * `day_starts` row is a real, ordinary case, not a data error. The original
 * version checked `wokeAtIso === null` and `continue`d before ever looking
 * at `closedAtIso`, which dropped that day from BOTH counts, identical to a
 * day where nothing happened at all — a real close silently vanishing from
 * a number the UI presents as a plain count. Fixed by checking `closedAtIso`
 * first: closedCount increments for ANY close mark; the average is computed
 * ONLY from closed days that also have a wake mark (a real, bounded delta
 * to divide hours by) — a close without a wake, or one whose delta is
 * unusable, still counts as closed, it just contributes no percent.
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
 * already treats "no meaningful denominator" everywhere else: null, not 0%
 * — and, since GAP-03, still correctly counted as closed regardless.
 */
export function bucketEfficiencyByClosedDay(days: readonly DayForEfficiencySplit[]): EfficiencyByClosedDay {
  const closedPercents: number[] = [];
  let closedCount = 0;
  let openCount = 0;
  for (const day of days) {
    if (day.closedAtIso !== null) {
      closedCount++;
      if (day.wokeAtIso !== null) {
        const deltaMinutes = computeDeltaMinutes(day.wokeAtIso, new Date(day.closedAtIso));
        const efficiency = computeEfficiency(day.hoursMinutes, deltaMinutes);
        if (efficiency !== null) closedPercents.push(efficiency.percent);
      }
      continue;
    }
    if (day.wokeAtIso !== null) openCount++;
  }
  const closedAvgPercent = closedPercents.length === 0 ? null : Math.round(closedPercents.reduce((a, b) => a + b, 0) / closedPercents.length);
  return { closedAvgPercent, closedCount, openCount };
}
