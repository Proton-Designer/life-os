import { describe, expect, it } from "vitest";
import {
  bucketAllocationMinutes,
  getSignalNoiseForRange,
  getWeeklySignalNoiseRatio,
  type AllocationRow,
  type SnDataSource,
} from "../sn-ratio";

function dataSourceWith(rows: AllocationRow[]): SnDataSource {
  return {
    getAllocations: async () => rows,
    getStoredAllocationSpans: async () => [],
    getSessionsWithStoredHours: async () => [],
  };
}

describe("bucketAllocationMinutes", () => {
  it("sums deen + business into signal", () => {
    const result = bucketAllocationMinutes([
      { domain: "deen", minutes: 30 },
      { domain: "business", minutes: 60 },
    ]);
    expect(result.signalMinutes).toBe(90);
  });

  it("sums school + fitness + co_op + wasted into noise, split from otherCommitments", () => {
    const result = bucketAllocationMinutes([
      { domain: "school", minutes: 15 },
      { domain: "fitness", minutes: 30 },
      { domain: "co_op", minutes: 15 },
      { domain: "wasted", minutes: 45 },
    ]);
    expect(result.otherCommitmentsMinutes).toBe(60);
    expect(result.wastedMinutes).toBe(45);
    expect(result.noiseMinutes).toBe(105);
  });

  it("ignores an unrecognized domain rather than folding it into either side", () => {
    const result = bucketAllocationMinutes([{ domain: "bogus", minutes: 100 }]);
    expect(result.signalMinutes).toBe(0);
    expect(result.noiseMinutes).toBe(0);
  });
});

describe("getWeeklySignalNoiseRatio", () => {
  it("computes a normal ratio from allocation minutes", async () => {
    const rows: AllocationRow[] = [
      { domain: "deen", minutes: 30 },
      { domain: "business", minutes: 90 },
      { domain: "school", minutes: 30 },
    ];
    const result = await getWeeklySignalNoiseRatio("user-1", new Date("2026-08-09T00:00:00Z"), dataSourceWith(rows));

    expect(result.signalMinutes).toBe(120);
    expect(result.noiseMinutes).toBe(30);
    expect(result.otherCommitmentsMinutes).toBe(30);
    expect(result.wastedMinutes).toBe(0);
    expect(result.display).toBe("4.0 : 1");
  });

  it("shows 'All Signal' when noise is zero", async () => {
    const rows: AllocationRow[] = [{ domain: "business", minutes: 120 }];
    const result = await getWeeklySignalNoiseRatio("user-1", new Date("2026-08-09T00:00:00Z"), dataSourceWith(rows));

    expect(result.display).toBe("All Signal");
  });

  it("shows 'No data' when there are zero allocation rows all week", async () => {
    const result = await getWeeklySignalNoiseRatio("user-1", new Date("2026-08-09T00:00:00Z"), dataSourceWith([]));

    expect(result.display).toBe("No data");
  });

  it("reports wasted separately from other commitments, never merged silently", async () => {
    const rows: AllocationRow[] = [
      { domain: "deen", minutes: 15 },
      { domain: "wasted", minutes: 105 },
    ];
    const result = await getWeeklySignalNoiseRatio("user-1", new Date("2026-08-09T00:00:00Z"), dataSourceWith(rows));

    expect(result.otherCommitmentsMinutes).toBe(0);
    expect(result.wastedMinutes).toBe(105);
    expect(result.noiseMinutes).toBe(105);
  });
});

describe("getSignalNoiseForRange", () => {
  it("queries a 1-day span for range='day'", async () => {
    let queried: { startIso: string; endIso: string } | null = null;
    const dataSource: SnDataSource = {
      getAllocations: async (_userId, weekStartIso, weekEndIso) => {
        queried = { startIso: weekStartIso, endIso: weekEndIso };
        return [];
      },
      getStoredAllocationSpans: async () => [],
      getSessionsWithStoredHours: async () => [],
    };
    const anchor = new Date("2026-08-10T05:00:00Z");
    await getSignalNoiseForRange("user-1", "day", anchor, dataSource);

    expect(queried).toEqual({
      startIso: "2026-08-10T05:00:00.000Z",
      endIso: "2026-08-11T05:00:00.000Z",
    });
  });

  it("queries a 7-day span for range='week'", async () => {
    let queried: { startIso: string; endIso: string } | null = null;
    const dataSource: SnDataSource = {
      getAllocations: async (_userId, weekStartIso, weekEndIso) => {
        queried = { startIso: weekStartIso, endIso: weekEndIso };
        return [];
      },
      getStoredAllocationSpans: async () => [],
      getSessionsWithStoredHours: async () => [],
    };
    const anchor = new Date("2026-08-10T05:00:00Z");
    await getSignalNoiseForRange("user-1", "week", anchor, dataSource);

    expect(queried).toEqual({
      startIso: "2026-08-10T05:00:00.000Z",
      endIso: "2026-08-17T05:00:00.000Z",
    });
  });

  it("computes the same signal/noise split as the weekly ratio", async () => {
    const rows: AllocationRow[] = [
      { domain: "deen", minutes: 30 },
      { domain: "school", minutes: 15 },
      { domain: "wasted", minutes: 15 },
    ];
    const result = await getSignalNoiseForRange("user-1", "day", new Date("2026-08-10T00:00:00Z"), dataSourceWith(rows));

    expect(result.signalMinutes).toBe(30);
    expect(result.otherCommitmentsMinutes).toBe(15);
    expect(result.wastedMinutes).toBe(15);
    expect(result.noiseMinutes).toBe(30);
    expect(result.display).toBe("1.0 : 1");
  });
});

// docs/superpowers/specs/2026-08-19-missed-lockin-hours.md, acceptance
// criterion 1 (Signal:Noise must read a missed hour as wasted) and 5 (no
// double-count — proven with real numbers, not just green assertions).
describe("Signal:Noise reads missed Lock-In hours as wasted", () => {
  const anchor = new Date("2026-08-19T00:00:00Z");
  const sessionStart = new Date("2026-08-19T12:00:00.000Z");

  it("a session with one answered hour, one missed hour, and one pending hour totals exactly 120min (2 resolved hours) — the pending hour contributes nothing, the missed hour adds exactly 60", async () => {
    // 12:00 answered (business, stored, already in getAllocations' rows),
    // 13:00 fired-and-superseded -> missed, 14:00 is the current due slot -> pending, excluded entirely.
    const now = new Date("2026-08-19T14:05:00.000Z");
    const dataSource: SnDataSource = {
      getAllocations: async () => [{ domain: "business", minutes: 60 }],
      getStoredAllocationSpans: async () => [],
      getSessionsWithStoredHours: async () => [
        {
          startedAt: sessionStart,
          endedAt: null,
          storedHours: [{ hourStartIso: "2026-08-19T12:00:00.000Z", domain: "business" }],
        },
      ],
    };
    const result = await getSignalNoiseForRange("user-1", "day", anchor, dataSource, now);

    expect(result.signalMinutes).toBe(60); // the one answered hour
    expect(result.wastedMinutes).toBe(60); // exactly the one missed hour, not the pending one
    expect(result.signalMinutes + result.noiseMinutes).toBe(120); // 2 resolved hours x 60min, pending hour excluded
  });

  it("does not double-count a missed hour whose surrounding 2h window was already confirmed (a wider stored row covers it)", async () => {
    const now = new Date("2026-08-19T14:05:00.000Z");
    const dataSource: SnDataSource = {
      getAllocations: async () => [{ domain: "wasted", minutes: 120 }], // the confirmed 2h window's own stored total, already includes this hour
      getStoredAllocationSpans: async () => [
        { start: new Date("2026-08-19T12:00:00.000Z"), end: new Date("2026-08-19T14:00:00.000Z") },
      ],
      getSessionsWithStoredHours: async () => [{ startedAt: sessionStart, endedAt: null, storedHours: [] }],
    };
    const result = await getSignalNoiseForRange("user-1", "day", anchor, dataSource, now);

    // Without the guard this would be 180 (120 stored + 60 re-added for the
    // "missed" 13:00 hour the stored window already accounts for).
    expect(result.wastedMinutes).toBe(120);
  });
});
