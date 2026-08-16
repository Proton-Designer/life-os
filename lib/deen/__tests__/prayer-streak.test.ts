import { describe, expect, it } from "vitest";
import { computePrayerStreak, accentForPrayerStreak } from "../prayer-streak";

describe("computePrayerStreak", () => {
  it("counts consecutive days where all 5 prayers are on_time or qada", () => {
    const streak = computePrayerStreak(
      {
        "2026-08-13": ["on_time", "on_time", "on_time", "on_time", "on_time"],
        "2026-08-14": ["on_time", "on_time", "qada", "on_time", "on_time"],
        "2026-08-15": ["on_time", "on_time", "missed", "on_time", "on_time"],
      },
      "2026-08-15"
    );
    // 08-15 breaks the chain (a missed prayer), so streak walks back from
    // 08-14 (the day before, since 08-15 itself isn't a qualifying day).
    expect(streak).toBe(2);
  });

  it("excludes a day with fewer than 5 logged prayers from qualifying", () => {
    const streak = computePrayerStreak({ "2026-08-15": ["on_time", "on_time"] }, "2026-08-15");
    expect(streak).toBe(0);
  });

  it("returns 0 for no history at all", () => {
    expect(computePrayerStreak({}, "2026-08-15")).toBe(0);
  });
});

describe("accentForPrayerStreak", () => {
  it("is info (not the domain amber) when there's no streak yet", () => {
    expect(accentForPrayerStreak(0)).toBe("info");
  });

  it("is positive once a real streak exists", () => {
    expect(accentForPrayerStreak(1)).toBe("business");
    expect(accentForPrayerStreak(30)).toBe("business");
  });
});
