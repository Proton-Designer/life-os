import { describe, expect, it } from "vitest";
import { bucketAllocationMinutes, type AllocationRow } from "../sn-ratio";
import { bucketSignalNoiseByWeek, type SnAllocationRow, type WeekBoundary } from "../sn-trend";
import { getInsightsKpis, type InsightsKpisDataSource, type InsightsKpisRow } from "@/lib/insights/insights-kpis";
import type { DomainWeights } from "../domain-classification";

/**
 * Regression guard for the gap the Opus Lead flagged closing ruling (c):
 * "two code paths classifying the same concept differently" — Insights'
 * noise-share KPI and the 6-week Signal:Noise trend chart both derive from
 * bucketAllocationMinutes, but each has its own data-fetching wrapper
 * (getInsightsKpis, bucketSignalNoiseByWeek) and could silently drift if a
 * future edit updates one wrapper's weight-threading and not the other's.
 *
 * This drives BOTH entry points with one shared fixture and asserts they
 * land on the identical signal/noise split — not two tests that each
 * independently assert a hardcoded number that happens to agree today.
 */
describe("Signal:Noise classification stays consistent across every consumer", () => {
  const weights: DomainWeights = { personal_growth: "background", school: "essential", work: "important" };
  const rows: AllocationRow[] = [
    { domain: "deen", minutes: 30, isWasted: false }, // personal_growth: background -> other
    { domain: "fitness", minutes: 20, isWasted: false }, // personal_growth: background -> other
    { domain: "school", minutes: 45, isWasted: false }, // school: essential -> signal
    { domain: "business", minutes: 15, isWasted: false }, // legacy-mapped, always signal
    { domain: "co_op", minutes: 10, isWasted: false }, // legacy-mapped, always other
    { domain: null, minutes: 25, isWasted: true }, // wasted
  ];

  const expected = bucketAllocationMinutes(rows, weights);
  // Sanity: the fixture actually exercises every branch (signal, other,
  // wasted, and a tier-flip away from the legacy default), not a
  // degenerate all-zero case that would pass trivially.
  it("the shared fixture itself is non-trivial", () => {
    expect(expected.signalMinutes).toBe(60); // school (45) + business (15)
    expect(expected.otherCommitmentsMinutes).toBe(60); // deen (30) + fitness (20) + co_op (10)
    expect(expected.wastedMinutes).toBe(25);
  });

  it("bucketSignalNoiseByWeek (the 6-week trend chart) matches bucketAllocationMinutes directly", () => {
    const weekStartIso = "2026-08-09T00:00:00.000Z";
    const weekEndIso = "2026-08-16T00:00:00.000Z";
    const snRows: SnAllocationRow[] = rows.map((r) => ({ ...r, windowStartIso: weekStartIso }));
    const weeks: WeekBoundary[] = [{ weekStartIso, weekEndIso, label: "Aug 9" }];

    const [week] = bucketSignalNoiseByWeek(snRows, weeks, weights);

    expect(week.signalMinutes).toBe(expected.signalMinutes);
    expect(week.otherCommitmentsMinutes).toBe(expected.otherCommitmentsMinutes);
    expect(week.wastedMinutes).toBe(expected.wastedMinutes);
    expect(week.noiseMinutes).toBe(expected.noiseMinutes);
  });

  it("getInsightsKpis' noise share (the coverage KPI row) matches bucketAllocationMinutes directly", async () => {
    const weekStartIso = "2026-08-09T00:00:00.000Z";
    const dataSource: InsightsKpisDataSource = {
      getAllCheckins: async (): Promise<InsightsKpisRow[]> => [
        { windowStartIso: weekStartIso, answered: true, allocations: rows },
      ],
      getDomainWeights: async () => weights,
    };
    const result = await getInsightsKpis("user-1", "2026-08-09", "2026-08-02", "UTC", dataSource);

    const expectedTotal = expected.signalMinutes + expected.noiseMinutes;
    const expectedNoisePct = expectedTotal === 0 ? 0 : (expected.noiseMinutes / expectedTotal) * 100;
    expect(result.noiseSharePct).toBeCloseTo(expectedNoisePct);
  });
});
