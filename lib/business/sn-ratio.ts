import { createClient } from "@/lib/supabase/server";
import { computeRatioDisplay } from "@/lib/insights/ratio-display";

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
 * to be priority based." Noise = School + Fitness + Co-op + Wasted —
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
  };
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
  dataSource: SnDataSource = defaultDataSource()
): Promise<SignalNoiseResult> {
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const rows = await dataSource.getAllocations(userId, weekStart.toISOString(), weekEnd.toISOString());
  const { signalMinutes, noiseMinutes, otherCommitmentsMinutes, wastedMinutes } = bucketAllocationMinutes(rows);
  const display = computeRatioDisplay(signalMinutes, noiseMinutes, signalMinutes + noiseMinutes > 0);
  return { signalMinutes, noiseMinutes, otherCommitmentsMinutes, wastedMinutes, display };
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
  dataSource: SnDataSource = defaultDataSource()
): Promise<SignalNoiseResult> {
  const rangeMs = (range === "week" ? 7 : 1) * 24 * 60 * 60 * 1000;
  const end = new Date(anchor.getTime() + rangeMs);
  const rows = await dataSource.getAllocations(userId, anchor.toISOString(), end.toISOString());
  const { signalMinutes, noiseMinutes, otherCommitmentsMinutes, wastedMinutes } = bucketAllocationMinutes(rows);
  const display = computeRatioDisplay(signalMinutes, noiseMinutes, signalMinutes + noiseMinutes > 0);
  return { signalMinutes, noiseMinutes, otherCommitmentsMinutes, wastedMinutes, display };
}
