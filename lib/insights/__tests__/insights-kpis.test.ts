import { describe, expect, it } from "vitest";
import { getInsightsKpis, type InsightsKpisDataSource, type InsightsKpisRow } from "../insights-kpis";

function dataSourceWith(rows: InsightsKpisRow[]): InsightsKpisDataSource {
  return { getAllCheckins: async () => rows, getDomainWeights: async () => null };
}

const weekStart = "2026-08-09"; // Sunday
const previousWeekStart = "2026-08-02";
const TZ = "America/Chicago";

function row(
  windowStartIso: string,
  answered: boolean,
  allocations: { domain: string | null; minutes: number; isWasted: boolean }[]
): InsightsKpisRow {
  return { windowStartIso, answered, allocations };
}

const wasted = (minutes: number) => ({ domain: null, minutes, isWasted: true });
const domain = (d: string, minutes: number) => ({ domain: d, minutes, isWasted: false });

describe("getInsightsKpis", () => {
  it("computes this week's coverage as answered / total slots", async () => {
    const result = await getInsightsKpis(
      "user-1",
      weekStart,
      previousWeekStart,
      TZ,
      dataSourceWith([
        row("2026-08-10T15:00:00Z", true, [domain("deen", 15)]),
        row("2026-08-10T17:00:00Z", false, []),
        row("2026-08-11T15:00:00Z", true, [domain("business", 30)]),
      ])
    );
    expect(result.coveragePct).toBeCloseTo(66.7, 0);
    expect(result.answeredCount).toBe(2);
    expect(result.totalSlots).toBe(3);
  });

  it("picks the domain with the most answered minutes this week, excluding wasted", async () => {
    const result = await getInsightsKpis(
      "user-1",
      weekStart,
      previousWeekStart,
      TZ,
      dataSourceWith([
        row("2026-08-10T15:00:00Z", true, [domain("business", 30)]),
        row("2026-08-10T17:00:00Z", true, [domain("deen", 15)]),
        row("2026-08-10T19:00:00Z", true, [wasted(105)]),
      ])
    );
    expect(result.mostFocusedDomain).toBe("business");
  });

  it("returns null for most-focused domain when nothing but wasted was answered this week", async () => {
    const result = await getInsightsKpis(
      "user-1",
      weekStart,
      previousWeekStart,
      TZ,
      dataSourceWith([row("2026-08-10T15:00:00Z", true, [wasted(120)])])
    );
    expect(result.mostFocusedDomain).toBeNull();
  });

  // Ruling (a): before the fix this file's `mostFocusedDomain` logic
  // excluded any row whose `domain` string equaled "wasted" — meaning a
  // real (user-created) domain named "wasted" could never become the
  // most-focused domain even with real, non-accounting minutes behind it.
  // Now exclusion is driven by `isWasted`, so a domain that merely shares
  // the name is treated like any other real domain.
  it("a domain literally named 'wasted' (isWasted: false) is eligible as most-focused, unlike the true wasted bucket", async () => {
    const result = await getInsightsKpis(
      "user-1",
      weekStart,
      previousWeekStart,
      TZ,
      dataSourceWith([row("2026-08-10T15:00:00Z", true, [domain("wasted", 60)])])
    );
    expect(result.mostFocusedDomain).toBe("wasted");
  });

  it("computes noise share this week and its delta vs last week", async () => {
    const result = await getInsightsKpis(
      "user-1",
      weekStart,
      previousWeekStart,
      TZ,
      dataSourceWith([
        // Last week: 60 signal, 60 noise (50%)
        row("2026-08-03T15:00:00Z", true, [domain("deen", 60)]),
        row("2026-08-03T17:00:00Z", true, [wasted(60)]),
        // This week: 90 signal, 30 noise (25%)
        row("2026-08-10T15:00:00Z", true, [domain("deen", 45)]),
        row("2026-08-10T17:00:00Z", true, [domain("business", 45)]),
        row("2026-08-10T19:00:00Z", true, [domain("school", 30)]),
      ])
    );
    expect(result.noiseSharePct).toBeCloseTo(25, 0);
    expect(result.noiseShareDeltaPct).toBeCloseTo(-25, 0);
    expect(result.hasNoiseComparisonData).toBe(true);
  });

  it("returns 0 coverage and 0 noise share, not NaN, when there's no data at all", async () => {
    const result = await getInsightsKpis("user-1", weekStart, previousWeekStart, TZ, dataSourceWith([]));
    expect(result.coveragePct).toBe(0);
    expect(result.noiseSharePct).toBe(0);
    expect(result.noiseShareDeltaPct).toBe(0);
    expect(result.mostFocusedDomain).toBeNull();
  });

  it("flags hasNoiseComparisonData false when there's no data at all — a 0 delta from two empty weeks isn't a real tie", async () => {
    const result = await getInsightsKpis("user-1", weekStart, previousWeekStart, TZ, dataSourceWith([]));
    expect(result.noiseShareDeltaPct).toBe(0);
    expect(result.hasNoiseComparisonData).toBe(false);
  });

  it("flags hasNoiseComparisonData false when only one of the two weeks has real minutes", async () => {
    const result = await getInsightsKpis(
      "user-1",
      weekStart,
      previousWeekStart,
      TZ,
      dataSourceWith([
        // Last week has nothing. This week has real signal minutes.
        row("2026-08-10T15:00:00Z", true, [domain("deen", 45)]),
      ])
    );
    expect(result.hasNoiseComparisonData).toBe(false);
  });

  // Ruling (c) scoping gap closed: noise share must read the SAME real
  // weights as the rest of the Signal:Noise system, not the legacy
  // fallback. A legacy-mode-shaped fixture would pass even with the wiring
  // silently missing, since deen already falls out to signal in that mode
  // by coincidence — this fixture flips a tier so it only passes if the
  // real weights are actually applied.
  it("uses real domain weight tiers for noise share, not the legacy fallback", async () => {
    const dataSource: InsightsKpisDataSource = {
      getAllCheckins: async () => [row("2026-08-10T15:00:00Z", true, [domain("deen", 30)])],
      // personal_growth: background -> deen is "other" here, the exact
      // opposite of its legacy-mode ("deen = signal") classification.
      getDomainWeights: async () => ({ personal_growth: "background" }),
    };
    const result = await getInsightsKpis("user-1", weekStart, previousWeekStart, TZ, dataSource);
    expect(result.noiseSharePct).toBe(100);
  });

  it("excludes an unanswered check-in's allocations from noise share and most-focused", async () => {
    const result = await getInsightsKpis(
      "user-1",
      weekStart,
      previousWeekStart,
      TZ,
      dataSourceWith([row("2026-08-10T15:00:00Z", false, [wasted(120)])])
    );
    expect(result.noiseSharePct).toBe(0);
    expect(result.mostFocusedDomain).toBeNull();
  });
});
