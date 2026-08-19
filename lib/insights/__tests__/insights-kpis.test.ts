import { describe, expect, it } from "vitest";
import { getInsightsKpis, type InsightsKpisDataSource, type InsightsKpisRow } from "../insights-kpis";

function dataSourceWith(rows: InsightsKpisRow[]): InsightsKpisDataSource {
  return { getAllCheckins: async () => rows };
}

const weekStart = "2026-08-09"; // Sunday
const previousWeekStart = "2026-08-02";
const TZ = "America/Chicago";

function row(windowStartIso: string, answered: boolean, allocations: { domain: string; minutes: number }[]): InsightsKpisRow {
  return { windowStartIso, answered, allocations };
}

describe("getInsightsKpis", () => {
  it("computes this week's coverage as answered / total slots", async () => {
    const result = await getInsightsKpis(
      "user-1",
      weekStart,
      previousWeekStart,
      TZ,
      dataSourceWith([
        row("2026-08-10T15:00:00Z", true, [{ domain: "deen", minutes: 15 }]),
        row("2026-08-10T17:00:00Z", false, []),
        row("2026-08-11T15:00:00Z", true, [{ domain: "business", minutes: 30 }]),
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
        row("2026-08-10T15:00:00Z", true, [{ domain: "business", minutes: 30 }]),
        row("2026-08-10T17:00:00Z", true, [{ domain: "deen", minutes: 15 }]),
        row("2026-08-10T19:00:00Z", true, [{ domain: "wasted", minutes: 105 }]),
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
      dataSourceWith([row("2026-08-10T15:00:00Z", true, [{ domain: "wasted", minutes: 120 }])])
    );
    expect(result.mostFocusedDomain).toBeNull();
  });

  it("computes noise share this week and its delta vs last week", async () => {
    const result = await getInsightsKpis(
      "user-1",
      weekStart,
      previousWeekStart,
      TZ,
      dataSourceWith([
        // Last week: 60 signal, 60 noise (50%)
        row("2026-08-03T15:00:00Z", true, [{ domain: "deen", minutes: 60 }]),
        row("2026-08-03T17:00:00Z", true, [{ domain: "wasted", minutes: 60 }]),
        // This week: 90 signal, 30 noise (25%)
        row("2026-08-10T15:00:00Z", true, [{ domain: "deen", minutes: 45 }]),
        row("2026-08-10T17:00:00Z", true, [{ domain: "business", minutes: 45 }]),
        row("2026-08-10T19:00:00Z", true, [{ domain: "school", minutes: 30 }]),
      ])
    );
    expect(result.noiseSharePct).toBeCloseTo(25, 0);
    expect(result.noiseShareDeltaPct).toBeCloseTo(-25, 0);
  });

  it("returns 0 coverage and 0 noise share, not NaN, when there's no data at all", async () => {
    const result = await getInsightsKpis("user-1", weekStart, previousWeekStart, TZ, dataSourceWith([]));
    expect(result.coveragePct).toBe(0);
    expect(result.noiseSharePct).toBe(0);
    expect(result.noiseShareDeltaPct).toBe(0);
    expect(result.mostFocusedDomain).toBeNull();
  });

  it("excludes an unanswered check-in's allocations from noise share and most-focused", async () => {
    const result = await getInsightsKpis(
      "user-1",
      weekStart,
      previousWeekStart,
      TZ,
      dataSourceWith([row("2026-08-10T15:00:00Z", false, [{ domain: "wasted", minutes: 120 }])])
    );
    expect(result.noiseSharePct).toBe(0);
    expect(result.mostFocusedDomain).toBeNull();
  });
});
