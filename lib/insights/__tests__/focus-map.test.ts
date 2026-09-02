import { describe, expect, it } from "vitest";
import { getFocusMap, type FocusMapDataSource } from "../focus-map";

function dataSourceWith(rows: { domain: string | null; minutes: number; isWasted: boolean }[]): FocusMapDataSource {
  return {
    getAllocations: async () => rows,
    getStoredAllocationSpans: async () => [],
    getSessionsWithStoredHours: async () => [],
  };
}

describe("getFocusMap", () => {
  it("segments sum to ~100% across all allocated minutes, grouped by domain", async () => {
    const rows = [
      { domain: "deen", minutes: 30, isWasted: false },
      { domain: "business", minutes: 60, isWasted: false },
      { domain: "fitness", minutes: 30, isWasted: false },
      { domain: "school", minutes: 15, isWasted: false },
      { domain: "co_op", minutes: 15, isWasted: false },
      { domain: null, minutes: 90, isWasted: true },
    ];

    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(rows));

    const totalPct = result.segments.reduce((sum, s) => sum + s.pct, 0);
    expect(totalPct).toBeCloseTo(100, 0);
  });

  it("keeps every real domain as its own segment — deen, business, school, fitness, co_op never merged", async () => {
    const rows = [
      { domain: "deen", minutes: 15, isWasted: false },
      { domain: "business", minutes: 15, isWasted: false },
      { domain: "school", minutes: 15, isWasted: false },
      { domain: "fitness", minutes: 15, isWasted: false },
      { domain: "co_op", minutes: 15, isWasted: false },
    ];

    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(rows));
    const domains = result.segments.map((s) => s.domain).sort();

    expect(domains).toEqual(["business", "co_op", "deen", "fitness", "school"]);
  });

  it("includes wasted as its own Focus Map segment, never dropped or folded elsewhere", async () => {
    const rows = [
      { domain: "business", minutes: 30, isWasted: false },
      { domain: null, minutes: 60, isWasted: true },
    ];

    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(rows));

    const wastedSegment = result.segments.find((s) => s.domain === "wasted");
    expect(wastedSegment).toBeDefined();
    expect(wastedSegment?.pct).toBeCloseTo(66.7, 0);
  });

  // Ruling (a): a real (user-created) domain that happens to be named
  // "wasted" must never merge into the true wasted-time segment. Before
  // this fix, both were aggregated through one Map keyed by the domain
  // string, so this exact input would have collapsed into a single
  // 90-minute "wasted" segment instead of two distinct 30/60 ones.
  it("a domain literally named 'wasted' (isWasted: false) never merges with the real wasted segment", async () => {
    const rows = [
      { domain: "wasted", minutes: 30, isWasted: false },
      { domain: null, minutes: 60, isWasted: true },
    ];

    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(rows));

    expect(result.segments).toHaveLength(2);
    const namedWasted = result.segments.find((s) => s.domain === "wasted" && s.minutes === 30);
    const realWasted = result.segments.find((s) => s.domain === "wasted" && s.minutes === 60);
    expect(namedWasted).toBeDefined();
    expect(realWasted).toBeDefined();
  });

  it("returns real minutes alongside pct, not a sample count — a segment is a duration, not a tally", async () => {
    const rows = [
      { domain: "business", minutes: 45, isWasted: false },
      { domain: "business", minutes: 15, isWasted: false },
      { domain: null, minutes: 30, isWasted: true },
    ];
    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(rows));
    const business = result.segments.find((s) => s.domain === "business");
    expect(business?.minutes).toBe(60);
  });

  it("sums multiple rows for the same domain across different checkins", async () => {
    const rows = [
      { domain: "deen", minutes: 15, isWasted: false },
      { domain: "deen", minutes: 15, isWasted: false },
      { domain: "deen", minutes: 30, isWasted: false },
    ];
    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(rows));
    expect(result.segments).toEqual([{ domain: "deen", minutes: 60, pct: 100 }]);
  });

  it("omits a domain with zero total minutes rather than showing an empty bar", async () => {
    const rows = [
      { domain: "deen", minutes: 30, isWasted: false },
      { domain: "business", minutes: 0, isWasted: false },
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
      getStoredAllocationSpans: async () => [],
      getSessionsWithStoredHours: async () => [],
    };
    const anchor = new Date("2026-08-10T05:00:00Z");
    await getFocusMap("user-1", "day", anchor, dataSource);
    await getFocusMap("user-1", "week", anchor, dataSource);

    expect(seen[0]).toEqual({ startIso: "2026-08-10T05:00:00.000Z", endIso: "2026-08-11T05:00:00.000Z" });
    expect(seen[1]).toEqual({ startIso: "2026-08-10T05:00:00.000Z", endIso: "2026-08-17T05:00:00.000Z" });
  });

  // docs/superpowers/specs/2026-08-19-missed-lockin-hours.md, acceptance criterion 1.
  it("folds a missed Lock-In hour into the wasted segment, without waiting for the surrounding window to be confirmed", async () => {
    const now = new Date("2026-08-19T14:05:00.000Z");
    const dataSource: FocusMapDataSource = {
      getAllocations: async () => [{ domain: "business", minutes: 30, isWasted: false }],
      getStoredAllocationSpans: async () => [],
      getSessionsWithStoredHours: async () => [
        { startedAt: new Date("2026-08-19T12:00:00.000Z"), endedAt: null, storedHours: [] },
      ],
    };
    const result = await getFocusMap("user-1", "day", new Date("2026-08-19T00:00:00Z"), dataSource, now);
    const wasted = result.segments.find((s) => s.domain === "wasted");
    expect(wasted?.minutes).toBe(60); // the one missed hour (13:00, superseded by 14:00's due slot)
  });

  it("does not double-count a missed hour already covered by a wider stored span", async () => {
    const now = new Date("2026-08-19T14:05:00.000Z");
    const dataSource: FocusMapDataSource = {
      getAllocations: async () => [{ domain: null, minutes: 120, isWasted: true }],
      getStoredAllocationSpans: async () => [
        { start: new Date("2026-08-19T12:00:00.000Z"), end: new Date("2026-08-19T14:00:00.000Z") },
      ],
      getSessionsWithStoredHours: async () => [
        { startedAt: new Date("2026-08-19T12:00:00.000Z"), endedAt: null, storedHours: [] },
      ],
    };
    const result = await getFocusMap("user-1", "day", new Date("2026-08-19T00:00:00Z"), dataSource, now);
    const wasted = result.segments.find((s) => s.domain === "wasted");
    expect(wasted?.minutes).toBe(120);
  });
});
