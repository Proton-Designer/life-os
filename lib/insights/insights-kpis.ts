import { createClient } from "@/lib/supabase/server";
import { addDaysToDateString, resolveLocalTime } from "@/lib/date-utils";
import { bucketAllocationMinutes, type AllocationRow } from "@/lib/business/sn-ratio";
import { getUserDomainWeights } from "@/lib/business/domain-weights";
import type { DomainWeights } from "@/lib/business/domain-classification";

export type InsightsKpisRow = { windowStartIso: string; answered: boolean; allocations: AllocationRow[] };

export type InsightsKpisDataSource = {
  getAllCheckins: (userId: string, startIso: string, endIso: string) => Promise<InsightsKpisRow[]>;
  /** Ruling (c): same fetch every other Signal:Noise surface uses (see
   * lib/business/domain-weights.ts) — so this KPI's noise share can never
   * classify a domain differently than the donut/trend chart beside it. */
  getDomainWeights: (userId: string) => Promise<DomainWeights | null>;
};

export type InsightsKpisResult = {
  coveragePct: number;
  answeredCount: number;
  totalSlots: number;
  mostFocusedDomain: string | null;
  noiseSharePct: number;
  noiseShareDeltaPct: number;
  // A delta of 0 is only a real "no change" when both weeks have real
  // signal/noise minutes behind them — noiseSharePct falls back to 0 when
  // a week has zero total minutes (see noiseSharePct below), so "0 vs 0"
  // from two empty weeks is indistinguishable from a genuine tie unless
  // this is checked separately. False when either week has no data at
  // all, in which case the delta isn't a real comparison.
  hasNoiseComparisonData: boolean;
};

function defaultDataSource(): InsightsKpisDataSource {
  return {
    async getAllCheckins(userId, startIso, endIso) {
      const supabase = await createClient();
      // kind = 'allocation' — same exclusion as everywhere else in the
      // allocation Signal:Noise system: legacy point-sample checkins have
      // no checkin_allocations rows to join against regardless.
      const { data } = await supabase
        .from("checkins")
        .select("window_start, answered, checkin_allocations(domain, minutes, is_wasted)")
        .eq("user_id", userId)
        .eq("kind", "allocation")
        .gte("window_start", startIso)
        .lt("window_start", endIso);
      return (data ?? []).map((r) => ({
        windowStartIso: r.window_start ?? "",
        answered: r.answered,
        allocations: (r.checkin_allocations ?? []).map((a) => ({ domain: a.domain, minutes: a.minutes, isWasted: a.is_wasted })),
      }));
    },
    getDomainWeights: getUserDomainWeights,
  };
}

function noiseShare(rows: InsightsKpisRow[], weights: DomainWeights | null): { pct: number; totalMinutes: number } {
  const answered = rows.filter((r) => r.answered);
  const allocations = answered.flatMap((r) => r.allocations);
  const { signalMinutes, noiseMinutes } = bucketAllocationMinutes(allocations, weights);
  const total = signalMinutes + noiseMinutes;
  return { pct: total === 0 ? 0 : (noiseMinutes / total) * 100, totalMinutes: total };
}

/**
 * The Insights KPI row is pinned to a fixed this-week/last-week window,
 * independent of the Focus Map/donut's own Day/Week toggle below it — one
 * stable "how's my week going" summary, not three cards that silently
 * change meaning every time the chart toggle is flipped. Single bulk
 * 2-week range query, bucketed in memory, per the data-layer convention.
 *
 * Converted off the point-sample tag_type model on 2026-08-19 (same pass
 * as getFocusMap, which this file depended on via SEGMENT_MAP — reading a
 * table that's had 23 rows, all unanswered, since before the allocation
 * system existed). `weekStart`/`previousWeekStart` are local date strings;
 * `timezone` resolves them to real boundaries via resolveLocalTime, not
 * `${weekStart}T00:00:00.000Z` (the UTC-midnight bug fixed everywhere else
 * in this system on the same date).
 */
export async function getInsightsKpis(
  userId: string,
  weekStart: string,
  previousWeekStart: string,
  timezone: string,
  dataSource: InsightsKpisDataSource = defaultDataSource()
): Promise<InsightsKpisResult> {
  const weekStartIso = resolveLocalTime(weekStart, "00:00", timezone).toISOString();
  const weekEndIso = resolveLocalTime(addDaysToDateString(weekStart, 7), "00:00", timezone).toISOString();
  const previousWeekStartIso = resolveLocalTime(previousWeekStart, "00:00", timezone).toISOString();

  const [rows, weights] = await Promise.all([
    dataSource.getAllCheckins(userId, previousWeekStartIso, weekEndIso),
    dataSource.getDomainWeights(userId),
  ]);
  const thisWeek = rows.filter((r) => r.windowStartIso >= weekStartIso && r.windowStartIso < weekEndIso);
  const lastWeek = rows.filter((r) => r.windowStartIso >= previousWeekStartIso && r.windowStartIso < weekStartIso);

  const thisWeekAnswered = thisWeek.filter((r) => r.answered);
  const coveragePct = thisWeek.length === 0 ? 0 : (thisWeekAnswered.length / thisWeek.length) * 100;

  const minutesByDomain = new Map<string, number>();
  for (const row of thisWeekAnswered) {
    for (const a of row.allocations) {
      if (a.isWasted || a.domain === null) continue; // not a focus area, same exclusion as the old noise/other_work skip
      minutesByDomain.set(a.domain, (minutesByDomain.get(a.domain) ?? 0) + a.minutes);
    }
  }
  let mostFocusedDomain: string | null = null;
  let maxMinutes = 0;
  for (const [domain, minutes] of minutesByDomain) {
    if (minutes > maxMinutes) {
      maxMinutes = minutes;
      mostFocusedDomain = domain;
    }
  }

  const thisWeekNoise = noiseShare(thisWeek, weights);
  const lastWeekNoise = noiseShare(lastWeek, weights);

  return {
    coveragePct,
    answeredCount: thisWeekAnswered.length,
    totalSlots: thisWeek.length,
    mostFocusedDomain,
    noiseSharePct: thisWeekNoise.pct,
    noiseShareDeltaPct: thisWeekNoise.pct - lastWeekNoise.pct,
    hasNoiseComparisonData: thisWeekNoise.totalMinutes > 0 && lastWeekNoise.totalMinutes > 0,
  };
}
