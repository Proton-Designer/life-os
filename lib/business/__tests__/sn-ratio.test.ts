import { describe, expect, it } from "vitest";
import { bucketAllocationMinutes, getWeeklySignalNoiseRatio, type AllocationRow, type SnDataSource } from "../sn-ratio";

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
