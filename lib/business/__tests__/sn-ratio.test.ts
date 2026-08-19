import { describe, expect, it } from "vitest";
import {
  bucketAllocationMinutes,
  getSignalNoiseForRange,
  getWeeklySignalNoiseRatio,
  type AllocationRow,
  type SnDataSource,
} from "../sn-ratio";

function dataSourceWith(rows: AllocationRow[]): SnDataSource {
  return { getAllocations: async () => rows };
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
