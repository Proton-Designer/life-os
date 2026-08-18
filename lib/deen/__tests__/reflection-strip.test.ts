import { describe, expect, it } from "vitest";
import { dayWeight, bucketForWeight, buildReflectionStrip, countClearDays } from "../reflection-strip";

describe("dayWeight", () => {
  it("sums entry tiers as the day's weight", () => {
    expect(dayWeight([{ tier: 1 }, { tier: 2 }, { tier: 3 }])).toBe(6);
  });

  it("is zero for a day with no entries", () => {
    expect(dayWeight([])).toBe(0);
  });
});

describe("bucketForWeight", () => {
  it("buckets 0 as clear", () => {
    expect(bucketForWeight(0)).toBe("clear");
  });

  it("buckets 1-2 as low", () => {
    expect(bucketForWeight(1)).toBe("low");
    expect(bucketForWeight(2)).toBe("low");
  });

  it("buckets 3-5 as mid", () => {
    expect(bucketForWeight(3)).toBe("mid");
    expect(bucketForWeight(5)).toBe("mid");
  });

  it("buckets 6+ as high", () => {
    expect(bucketForWeight(6)).toBe("high");
    expect(bucketForWeight(20)).toBe("high");
  });
});

describe("buildReflectionStrip", () => {
  it("returns the last 30 days ending today, oldest first", () => {
    const days = buildReflectionStrip([], "2026-08-30");
    expect(days).toHaveLength(30);
    expect(days[0].date).toBe("2026-08-01");
    expect(days[29].date).toBe("2026-08-30");
  });

  it("a past day with no entries is clear (weight 0)", () => {
    const days = buildReflectionStrip([], "2026-08-30");
    const past = days.filter((d) => d.date !== "2026-08-30");
    expect(past.every((d) => d.weight === 0 && d.bucket === "clear")).toBe(true);
  });

  it("today with no entries is in_progress, not clear — the day hasn't finished, so it hasn't earned a clear verdict", () => {
    const days = buildReflectionStrip([], "2026-08-30");
    const today = days.find((d) => d.date === "2026-08-30");
    expect(today?.bucket).toBe("in_progress");
  });

  it("today with entries already logged shows its real bucket, not in_progress — that weight already happened", () => {
    const days = buildReflectionStrip([{ date: "2026-08-30", tier: 3 }], "2026-08-30");
    const today = days.find((d) => d.date === "2026-08-30");
    expect(today?.bucket).toBe("mid");
  });

  it("sums multiple entries on the same day into that day's weight and bucket", () => {
    const days = buildReflectionStrip(
      [
        { date: "2026-08-30", tier: 2 },
        { date: "2026-08-30", tier: 2 },
      ],
      "2026-08-30"
    );
    const today = days.find((d) => d.date === "2026-08-30");
    expect(today?.weight).toBe(4);
    expect(today?.bucket).toBe("mid");
  });

  it("ignores entries outside the 30-day window", () => {
    const days = buildReflectionStrip([{ date: "2026-07-01", tier: 3 }], "2026-08-30");
    expect(days.every((d) => d.weight === 0)).toBe(true);
  });
});

describe("countClearDays", () => {
  it("counts only clear-bucket days", () => {
    const strip = buildReflectionStrip(
      [
        { date: "2026-08-30", tier: 1 },
        { date: "2026-08-29", tier: 3 },
      ],
      "2026-08-30"
    );
    // 30 days total, 2 with entries (not clear), 28 clear.
    expect(countClearDays(strip)).toBe(28);
  });

  it("never counts an empty today as clear — the headline stays honest about an unfinished day", () => {
    const strip = buildReflectionStrip([], "2026-08-30");
    // Today is in_progress, not clear, so it's excluded from the count on
    // its own — no separate "last 30 completed days" wording needed.
    expect(countClearDays(strip)).toBe(29);
  });
});
