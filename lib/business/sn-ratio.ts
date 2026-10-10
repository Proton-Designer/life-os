import { createClient } from "@/lib/supabase/server";
import { computeRatioDisplay } from "@/lib/insights/ratio-display";
import { deriveSessionMinutesByDomain, type SessionRange } from "@/lib/checkins/session-accounting";
import { getStoredAllocationSpans, getSessionRanges } from "@/lib/checkins/session-accounting-queries";
import { classifyDomain, type DomainWeights } from "./domain-classification";
import { getUserDomainWeights } from "./domain-weights";

/**
 * `domain` is `null` exactly when `isWasted` is `true` (mirrors
 * checkin_allocations' own nullable-XOR shape post-108). `isWasted` — not a
 * `domain === "wasted"` string check — is what makes a row count as
 * unaccounted time; the string "wasted" itself carries no special meaning
 * any more, so once a real (user-created) domain can be named anything, one
 * named "wasted" is just an ordinary domain, not an accounting collision.
 */
export type AllocationRow = { domain: string | null; minutes: number; isWasted: boolean };

export type SignalNoiseResult = {
  signalMinutes: number;
  noiseMinutes: number;
  otherCommitmentsMinutes: number;
  wastedMinutes: number;
  display: string;
};

/**
 * Priority-allocation Signal:Noise (ruling c, R10): signal/other is no
 * longer a hardcoded pair — `classifyDomain` (lib/business/domain-
 * classification.ts) derives it from the user's own `user_domains.weight`
 * tiers (essential = signal, important/background = other), with the
 * original hardcoded split (deen+business = signal) as the exact fallback
 * for a legacy-mode account (`weights: null` — reproduces today's behavior
 * with zero regression for the one account this matters most for; see that
 * module's own header for the full reasoning, including why deen and
 * fitness share one tier and why business/co_op keep their legacy meaning
 * in every mode).
 *
 * Noise is always reported SPLIT (otherCommitments vs wasted), never just a
 * combined total — a heavy school week and a lost afternoon both land on
 * the noise side and are nothing alike; collapsing them would make a
 * legitimate tradeoff indistinguishable from a leak and quietly pressure
 * skipping the gym to look good on paper.
 */
export function bucketAllocationMinutes(
  rows: AllocationRow[],
  weights: DomainWeights | null = null
): {
  signalMinutes: number;
  noiseMinutes: number;
  otherCommitmentsMinutes: number;
  wastedMinutes: number;
} {
  let signalMinutes = 0;
  let otherCommitmentsMinutes = 0;
  let wastedMinutes = 0;
  for (const row of rows) {
    if (row.isWasted) {
      wastedMinutes += row.minutes;
    } else if (row.domain !== null) {
      const classification = classifyDomain(row.domain, weights);
      if (classification === "signal") signalMinutes += row.minutes;
      else if (classification === "other") otherCommitmentsMinutes += row.minutes;
      // "unrecognized" (and a null, non-wasted domain) is ignored, not
      // silently folded into either side — better a gap than a miscounted
      // total. A user-created Work subdomain key lands here today, since
      // it isn't wired into Signal:Noise tagging yet (T-0002).
    }
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
  /** Every stored allocation checkin's own [window_start, window_end) span in range -- session minutes inside one are already in that row, so they are not added again. */
  getStoredAllocationSpans: (userId: string, startIso: string, endIso: string) => Promise<{ start: Date; end: Date }[]>;
  /** Every Deep Work / Deep Study session overlapping the range, each with the domain its kind is credited to (session-accounting.ts). */
  getSessionRanges: (userId: string, startIso: string, endIso: string) => Promise<SessionRange[]>;
  /** Ruling (c): the user's real top-level domain weight tiers, or null for
   * a legacy-mode account (no active user_domains rows) — classifyDomain's
   * exact fallback signal. */
  getDomainWeights: (userId: string) => Promise<DomainWeights | null>;
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
        .select("checkin_allocations(domain, minutes, is_wasted)")
        .eq("user_id", userId)
        .eq("kind", "allocation")
        .gte("window_start", weekStartIso)
        .lt("window_start", weekEndIso);
      return (data ?? []).flatMap((c) =>
        (c.checkin_allocations ?? []).map((row) => ({ domain: row.domain, minutes: row.minutes, isWasted: row.is_wasted }))
      );
    },
    getDomainWeights: getUserDomainWeights,
    getStoredAllocationSpans,
    getSessionRanges,
  };
}

/**
 * Deep sessions account for themselves: their minutes count to the session's own domain (Deep Work -> Business, Deep
 * Study -> School) without anyone confirming an hour, except the minutes an answered allocation window already holds.
 * See session-accounting.ts's deriveSessionMinutesByDomain for the range bound and the double-count guard.
 */
async function getSessionAccountedRows(
  userId: string,
  startIso: string,
  endIso: string,
  now: Date,
  dataSource: SnDataSource
): Promise<AllocationRow[]> {
  const [storedSpans, sessions] = await Promise.all([
    dataSource.getStoredAllocationSpans(userId, startIso, endIso),
    dataSource.getSessionRanges(userId, startIso, endIso),
  ]);
  return deriveSessionMinutesByDomain(sessions, storedSpans, new Date(startIso), new Date(endIso), now).map((d) => ({
    domain: d.domain,
    minutes: d.minutes,
    isWasted: false,
  }));
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
  const [rows, sessionRows, weights] = await Promise.all([
    dataSource.getAllocations(userId, weekStartIso, weekEndIso),
    getSessionAccountedRows(userId, weekStartIso, weekEndIso, now, dataSource),
    dataSource.getDomainWeights(userId),
  ]);
  const { signalMinutes, noiseMinutes, otherCommitmentsMinutes, wastedMinutes } = bucketAllocationMinutes([...rows, ...sessionRows], weights);
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
  dataSource: SnDataSource = defaultDataSource(),
  now: Date = new Date()
): Promise<SignalNoiseResult> {
  const rangeMs = (range === "week" ? 7 : 1) * 24 * 60 * 60 * 1000;
  const end = new Date(anchor.getTime() + rangeMs);
  const startIso = anchor.toISOString();
  const endIso = end.toISOString();
  const [rows, sessionRows, weights] = await Promise.all([
    dataSource.getAllocations(userId, startIso, endIso),
    getSessionAccountedRows(userId, startIso, endIso, now, dataSource),
    dataSource.getDomainWeights(userId),
  ]);
  const { signalMinutes, noiseMinutes, otherCommitmentsMinutes, wastedMinutes } = bucketAllocationMinutes([...rows, ...sessionRows], weights);
  const display = computeRatioDisplay(signalMinutes, noiseMinutes, signalMinutes + noiseMinutes > 0);
  return { signalMinutes, noiseMinutes, otherCommitmentsMinutes, wastedMinutes, display };
}
