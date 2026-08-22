import { createClient } from "@/lib/supabase/server";
import { computeRatioDisplay } from "@/lib/insights/ratio-display";
import { deriveExtraMissedWasteMinutes } from "@/lib/checkins/session-hour-status";
import { getStoredAllocationSpans, getSessionsWithStoredHours } from "@/lib/checkins/missed-hour-queries";

export type AllocationRow = { domain: string; minutes: number };

export type SignalNoiseResult = {
  signalMinutes: number;
  noiseMinutes: number;
  otherCommitmentsMinutes: number;
  wastedMinutes: number;
  display: string;
};

const SIGNAL_DOMAINS = new Set(["deen", "business"]);
const OTHER_COMMITMENT_DOMAINS = new Set(["school", "fitness", "co_op"]);

/**
 * Priority-allocation Signal:Noise, per Ayman's 2026-08-19 ruling
 * (docs/superpowers/specs/2026-08-19-checkin-allocation-system.md):
 * Signal = Deen + Business, his stated priorities — "after deen, my
 * priority is business... I can't include everything under signal, it has
 * to be priority based." Noise = School + Fitness + Work + Wasted —
 * everything else. Sleep is outside the measurement window entirely and
 * never queried, so it's neither signal nor noise, not just excluded here.
 *
 * Noise is always reported SPLIT (otherCommitments vs wasted), never just a
 * combined total — a heavy school week and a lost afternoon both land on
 * the noise side and are nothing alike; collapsing them would make a
 * legitimate tradeoff indistinguishable from a leak and quietly pressure
 * skipping the gym to look good on paper.
 */
export function bucketAllocationMinutes(rows: AllocationRow[]): {
  signalMinutes: number;
  noiseMinutes: number;
  otherCommitmentsMinutes: number;
  wastedMinutes: number;
} {
  let signalMinutes = 0;
  let otherCommitmentsMinutes = 0;
  let wastedMinutes = 0;
  for (const row of rows) {
    if (SIGNAL_DOMAINS.has(row.domain)) signalMinutes += row.minutes;
    else if (row.domain === "wasted") wastedMinutes += row.minutes;
    else if (OTHER_COMMITMENT_DOMAINS.has(row.domain)) otherCommitmentsMinutes += row.minutes;
    // An unrecognized domain string is ignored, not silently folded into
    // either side — better a gap than a miscounted total.
  }
  return {
    signalMinutes,
    noiseMinutes: otherCommitmentsMinutes + wastedMinutes,
    otherCommitmentsMinutes,
    wastedMinutes,
  };
}

export type SnDataSource = {
  getAllocations: (userId: string, weekStartIso: string, weekEndIso: string) => Promise<AllocationRow[]>;
  /** Every stored allocation checkin's own [window_start, window_end) span in range, hour-level and window-level alike — used to avoid double-counting a missed hour already covered by a wider confirmed row. See getMissedHourWasteMinutes. */
  getStoredAllocationSpans: (userId: string, startIso: string, endIso: string) => Promise<{ start: Date; end: Date }[]>;
  /** Every Lock-In session overlapping the range, with its own stored hourly rows — feeds the same missed-hour-as-wasted derivation the live queue uses (session-hour-status.ts). */
  getSessionsWithStoredHours: (
    userId: string,
    startIso: string,
    endIso: string
  ) => Promise<{ startedAt: Date; endedAt: Date | null; storedHours: { hourStartIso: string; domain: "business" | "wasted" }[] }[]>;
};

function defaultDataSource(): SnDataSource {
  return {
    async getAllocations(userId, weekStartIso, weekEndIso) {
      const supabase = await createClient();
      // kind = 'allocation' deliberately excludes every legacy point-sample
      // checkin (2026-08-15 and earlier): they predate checkin_allocations
      // and have no minutes rows to join against regardless, but filtering
      // by kind states outright what this metric now measures rather than
      // relying on an incidental join-emptiness. Per the Lead's 2026-08-19
      // ruling: excluded, not zero-weighted — all 23 legacy rows are
      // unanswered anyway, so this changes zero real numbers.
      const { data } = await supabase
        .from("checkins")
        .select("checkin_allocations(domain, minutes)")
        .eq("user_id", userId)
        .eq("kind", "allocation")
        .gte("window_start", weekStartIso)
        .lt("window_start", weekEndIso);
      return (data ?? []).flatMap((c) => c.checkin_allocations ?? []);
    },
    getStoredAllocationSpans,
    getSessionsWithStoredHours,
  };
}

/**
 * Adds acceptance criterion 1's missing piece
 * (docs/superpowers/specs/2026-08-19-missed-lockin-hours.md): a Lock-In
 * hour that's been superseded and never answered reads as `wasted` here
 * too, not silently absent, without waiting for (or double-counting
 * against) the surrounding 2h allocation window ever being confirmed. See
 * session-hour-status.ts's deriveExtraMissedWasteMinutes for the bound
 * (this range only) and the double-count guard (stored spans).
 */
async function getMissedHourWasteMinutes(
  userId: string,
  startIso: string,
  endIso: string,
  now: Date,
  dataSource: SnDataSource
): Promise<number> {
  const [storedSpans, sessions] = await Promise.all([
    dataSource.getStoredAllocationSpans(userId, startIso, endIso),
    dataSource.getSessionsWithStoredHours(userId, startIso, endIso),
  ]);
  return deriveExtraMissedWasteMinutes(sessions, storedSpans, new Date(startIso), new Date(endIso), now);
}

/**
 * Weekly Signal:Noise, in minutes, from the allocation check-in system.
 * `weekStart` must already be resolved to local midnight for the user's
 * timezone (e.g. via `resolveLocalTime(dateStr, "00:00", timezone)`) — this
 * function's own week-length arithmetic is timezone-agnostic and only as
 * correct as the boundary it's given.
 */
export async function getWeeklySignalNoiseRatio(
  userId: string,
  weekStart: Date,
  dataSource: SnDataSource = defaultDataSource(),
  now: Date = new Date()
): Promise<SignalNoiseResult> {
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekStartIso = weekStart.toISOString();
  const weekEndIso = weekEnd.toISOString();
  const [rows, extraWasted] = await Promise.all([
    dataSource.getAllocations(userId, weekStartIso, weekEndIso),
    getMissedHourWasteMinutes(userId, weekStartIso, weekEndIso, now, dataSource),
  ]);
  const { signalMinutes, noiseMinutes, otherCommitmentsMinutes, wastedMinutes } = bucketAllocationMinutes(rows);
  const display = computeRatioDisplay(
    signalMinutes,
    noiseMinutes + extraWasted,
    signalMinutes + noiseMinutes + extraWasted > 0
  );
  return {
    signalMinutes,
    noiseMinutes: noiseMinutes + extraWasted,
    otherCommitmentsMinutes,
    wastedMinutes: wastedMinutes + extraWasted,
    display,
  };
}

/**
 * Day- or week-scoped Signal:Noise, in minutes, from the allocation
 * check-in system — Insights' donut (2026-08-19: converted off
 * lib/insights/focus-map.ts's tag_type-based ratio, which now only feeds
 * the Focus Map's own segments, a genuinely different data model). `anchor`
 * must already be resolved to local midnight, same requirement as
 * getWeeklySignalNoiseRatio's `weekStart`.
 */
export async function getSignalNoiseForRange(
  userId: string,
  range: "day" | "week",
  anchor: Date,
  dataSource: SnDataSource = defaultDataSource(),
  now: Date = new Date()
): Promise<SignalNoiseResult> {
  const rangeMs = (range === "week" ? 7 : 1) * 24 * 60 * 60 * 1000;
  const end = new Date(anchor.getTime() + rangeMs);
  const startIso = anchor.toISOString();
  const endIso = end.toISOString();
  const [rows, extraWasted] = await Promise.all([
    dataSource.getAllocations(userId, startIso, endIso),
    getMissedHourWasteMinutes(userId, startIso, endIso, now, dataSource),
  ]);
  const { signalMinutes, noiseMinutes, otherCommitmentsMinutes, wastedMinutes } = bucketAllocationMinutes(rows);
  const display = computeRatioDisplay(
    signalMinutes,
    noiseMinutes + extraWasted,
    signalMinutes + noiseMinutes + extraWasted > 0
  );
  return {
    signalMinutes,
    noiseMinutes: noiseMinutes + extraWasted,
    otherCommitmentsMinutes,
    wastedMinutes: wastedMinutes + extraWasted,
    display,
  };
}
