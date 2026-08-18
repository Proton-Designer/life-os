import { describe, expect, it } from "vitest";
import { buildTimeOfDayDistribution, dominantBucket, type TimeOfDayBucket } from "../reflection-time-of-day";

function entryAt(isoUtc: string) {
  return { createdAt: isoUtc };
}

describe("buildTimeOfDayDistribution", () => {
  it("returns null (not enough data) below 8 entries", () => {
    const entries = Array.from({ length: 7 }, () => entryAt("2026-08-10T12:00:00Z"));
    expect(buildTimeOfDayDistribution(entries, "UTC")).toBeNull();
  });

  it("returns real buckets at 8 or more entries", () => {
    const entries = Array.from({ length: 8 }, () => entryAt("2026-08-10T12:00:00Z"));
    const result = buildTimeOfDayDistribution(entries, "UTC");
    expect(result).not.toBeNull();
  });

  it("buckets entries by local hour, not UTC hour", () => {
    // 2026-08-10T04:00:00Z is 11pm CDT (UTC-5) the previous evening —
    // must land in the evening bucket for America/Chicago, not the
    // early-morning bucket a naive UTC-hour read would produce.
    const entries = Array.from({ length: 8 }, () => entryAt("2026-08-10T04:00:00Z"));
    const result = buildTimeOfDayDistribution(entries, "America/Chicago")!;
    const evening = result.find((b) => b.label.toLowerCase().includes("evening"));
    const night = result.find((b) => b.label.toLowerCase().includes("night"));
    expect(evening?.count).toBe(8);
    expect(night?.count).toBe(0);
  });

  it("covers all 24 hours across its buckets with no overlap or gap", () => {
    const entries = Array.from({ length: 24 }, (_, h) =>
      entryAt(`2026-08-10T${String(h).padStart(2, "0")}:00:00Z`)
    );
    const result = buildTimeOfDayDistribution(entries, "UTC")!;
    const total = result.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(24);
  });
});

describe("dominantBucket", () => {
  it("returns null when nothing clusters clearly (evenly spread)", () => {
    const buckets: TimeOfDayBucket[] = [
      { label: "Night", startHour: 0, endHour: 6, count: 2 },
      { label: "Morning", startHour: 6, endHour: 12, count: 2 },
      { label: "Afternoon", startHour: 12, endHour: 18, count: 2 },
      { label: "Evening", startHour: 18, endHour: 24, count: 2 },
    ];
    expect(dominantBucket(buckets)).toBeNull();
  });

  it("returns the bucket holding a clear plurality of entries", () => {
    const buckets: TimeOfDayBucket[] = [
      { label: "Night", startHour: 0, endHour: 6, count: 6 },
      { label: "Morning", startHour: 6, endHour: 12, count: 1 },
      { label: "Afternoon", startHour: 12, endHour: 18, count: 1 },
      { label: "Evening", startHour: 18, endHour: 24, count: 0 },
    ];
    expect(dominantBucket(buckets)?.label).toBe("Night");
  });

  it("returns null when there are no entries at all", () => {
    const buckets: TimeOfDayBucket[] = [
      { label: "Night", startHour: 0, endHour: 6, count: 0 },
      { label: "Morning", startHour: 6, endHour: 12, count: 0 },
    ];
    expect(dominantBucket(buckets)).toBeNull();
  });
});
