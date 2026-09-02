import { describe, expect, it } from "vitest";
import { bucketSignalNoiseByWeek, type SnAllocationRow } from "../sn-trend";

describe("bucketSignalNoiseByWeek", () => {
  it("buckets allocation minutes into signal/noise per week", () => {
    const weeks = bucketSignalNoiseByWeek(
      [
        { windowStartIso: "2026-08-03T10:00:00Z", domain: "deen", minutes: 30, isWasted: false },
        { windowStartIso: "2026-08-03T11:00:00Z", domain: "school", minutes: 30, isWasted: false },
        { windowStartIso: "2026-08-10T10:00:00Z", domain: "business", minutes: 60, isWasted: false },
        { windowStartIso: "2026-08-10T12:00:00Z", domain: "business", minutes: 60, isWasted: false },
      ] satisfies SnAllocationRow[],
      [
        { weekStartIso: "2026-08-02T00:00:00Z", weekEndIso: "2026-08-09T00:00:00Z", label: "Aug 2" },
        { weekStartIso: "2026-08-09T00:00:00Z", weekEndIso: "2026-08-16T00:00:00Z", label: "Aug 9" },
      ]
    );
    expect(weeks[0]).toEqual({
      label: "Aug 2",
      signalMinutes: 30,
      noiseMinutes: 30,
      otherCommitmentsMinutes: 30,
      wastedMinutes: 0,
      display: "1.0 : 1",
    });
    expect(weeks[1]).toEqual({
      label: "Aug 9",
      signalMinutes: 120,
      noiseMinutes: 0,
      otherCommitmentsMinutes: 0,
      wastedMinutes: 0,
      display: "All Signal",
    });
  });

  it("excludes a row outside the week's own boundary", () => {
    const weeks = bucketSignalNoiseByWeek(
      [{ windowStartIso: "2026-08-09T00:00:00Z", domain: "deen", minutes: 30, isWasted: false }] satisfies SnAllocationRow[],
      [{ weekStartIso: "2026-08-02T00:00:00Z", weekEndIso: "2026-08-09T00:00:00Z", label: "Aug 2" }]
    );
    expect(weeks[0].signalMinutes).toBe(0);
    expect(weeks[0].display).toBe("No data");
  });

  it("returns 'No data' for a week with zero allocation rows at all, not a misleading 0:1", () => {
    const weeks = bucketSignalNoiseByWeek(
      [],
      [{ weekStartIso: "2026-08-02T00:00:00Z", weekEndIso: "2026-08-09T00:00:00Z", label: "Aug 2" }]
    );
    expect(weeks[0].display).toBe("No data");
  });
});
