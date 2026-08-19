import { describe, expect, it } from "vitest";
import { getFocusMap, type FocusMapDataSource } from "../focus-map";

function dataSourceWith(rows: { domain: string; minutes: number }[]): FocusMapDataSource {
  return { getAllocations: async () => rows };
}

describe("getFocusMap", () => {
  it("segments sum to ~100% across all allocated minutes, grouped by domain", async () => {
    const rows = [
      { domain: "deen", minutes: 30 },
      { domain: "business", minutes: 60 },
      { domain: "fitness", minutes: 30 },
      { domain: "school", minutes: 15 },
      { domain: "co_op", minutes: 15 },
      { domain: "wasted", minutes: 90 },
    ];

    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(rows));

    const totalPct = result.segments.reduce((sum, s) => sum + s.pct, 0);
    expect(totalPct).toBeCloseTo(100, 0);
  });

  it("keeps every real domain as its own segment — deen, business, school, fitness, co_op never merged", async () => {
    const rows = [
      { domain: "deen", minutes: 15 },
      { domain: "business", minutes: 15 },
      { domain: "school", minutes: 15 },
      { domain: "fitness", minutes: 15 },
      { domain: "co_op", minutes: 15 },
    ];

    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(rows));
    const domains = result.segments.map((s) => s.domain).sort();

    expect(domains).toEqual(["business", "co_op", "deen", "fitness", "school"]);
  });

  it("includes wasted as its own Focus Map segment, never dropped or folded elsewhere", async () => {
    const rows = [
      { domain: "business", minutes: 30 },
      { domain: "wasted", minutes: 60 },
    ];

    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(rows));

    const wastedSegment = result.segments.find((s) => s.domain === "wasted");
    expect(wastedSegment).toBeDefined();
    expect(wastedSegment?.pct).toBeCloseTo(66.7, 0);
  });

  it("returns real minutes alongside pct, not a sample count — a segment is a duration, not a tally", async () => {
    const rows = [
      { domain: "business", minutes: 45 },
      { domain: "business", minutes: 15 },
      { domain: "wasted", minutes: 30 },
    ];
    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(rows));
    const business = result.segments.find((s) => s.domain === "business");
    expect(business?.minutes).toBe(60);
  });

  it("sums multiple rows for the same domain across different checkins", async () => {
    const rows = [
      { domain: "deen", minutes: 15 },
      { domain: "deen", minutes: 15 },
      { domain: "deen", minutes: 30 },
    ];
    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(rows));
    expect(result.segments).toEqual([{ domain: "deen", minutes: 60, pct: 100 }]);
  });

  it("omits a domain with zero total minutes rather than showing an empty bar", async () => {
    const rows = [
      { domain: "deen", minutes: 30 },
      { domain: "business", minutes: 0 },
    ];
    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(rows));
    expect(result.segments.map((s) => s.domain)).toEqual(["deen"]);
  });

  it("returns no segments and no NaN when there's no data at all", async () => {
    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith([]));
    expect(result.segments).toEqual([]);
  });

  it("queries a 1-day span for range='day' and a 7-day span for range='week'", async () => {
    const seen: { startIso: string; endIso: string }[] = [];
    const dataSource: FocusMapDataSource = {
      getAllocations: async (_userId, startIso, endIso) => {
        seen.push({ startIso, endIso });
        return [];
      },
    };
    const anchor = new Date("2026-08-10T05:00:00Z");
    await getFocusMap("user-1", "day", anchor, dataSource);
    await getFocusMap("user-1", "week", anchor, dataSource);

    expect(seen[0]).toEqual({ startIso: "2026-08-10T05:00:00.000Z", endIso: "2026-08-11T05:00:00.000Z" });
    expect(seen[1]).toEqual({ startIso: "2026-08-10T05:00:00.000Z", endIso: "2026-08-17T05:00:00.000Z" });
  });
});
