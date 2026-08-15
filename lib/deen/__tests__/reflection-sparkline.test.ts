import { describe, expect, it } from "vitest";
import { buildReflectionSparkline } from "../reflection-sparkline";

describe("buildReflectionSparkline", () => {
  it("returns the last 7 days ending today, oldest first", () => {
    const days = buildReflectionSparkline([], "2026-08-10");
    expect(days.map((d) => d.date)).toEqual([
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
      "2026-08-10",
    ]);
  });

  it("buckets entries into the correct day and tier", () => {
    const days = buildReflectionSparkline(
      [
        { date: "2026-08-10", tier: 1 },
        { date: "2026-08-10", tier: 1 },
        { date: "2026-08-09", tier: 3 },
      ],
      "2026-08-10"
    );

    const today = days.find((d) => d.date === "2026-08-10");
    const yesterday = days.find((d) => d.date === "2026-08-09");

    expect(today?.counts[1]).toBe(2);
    expect(today?.counts[2]).toBe(0);
    expect(today?.counts[3]).toBe(0);
    expect(yesterday?.counts[3]).toBe(1);
  });

  it("ignores entries outside the 7-day window", () => {
    const days = buildReflectionSparkline([{ date: "2026-08-01", tier: 2 }], "2026-08-10");
    const total = days.reduce((sum, d) => sum + d.counts[1] + d.counts[2] + d.counts[3], 0);
    expect(total).toBe(0);
  });
});
