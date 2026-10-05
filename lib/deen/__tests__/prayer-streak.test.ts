import { describe, expect, it } from "vitest";
import { computePrayerStreak, accentForPrayerStreak, computeLongestPrayerStreak, onTimeDaysFromRows, isOnTimeDay } from "../prayer-streak";

describe("computePrayerStreak", () => {
  it("counts consecutive days where all 5 prayers are on_time", () => {
    const streak = computePrayerStreak(
      {
        "2026-08-12": ["on_time", "on_time", "on_time", "on_time", "on_time"],
        "2026-08-13": ["on_time", "on_time", "on_time", "on_time", "on_time"],
        "2026-08-14": ["on_time", "on_time", "on_time", "on_time", "on_time"],
        "2026-08-15": ["on_time", "on_time", "missed", "on_time", "on_time"],
      },
      "2026-08-15"
    );
    // 08-15 isn't a qualifying day and is "today" (not over), so the walk starts from 08-14.
    expect(streak).toBe(3);
  });

  it("a prayer made up through Qada BREAKS the streak (it no longer qualifies the day)", () => {
    const streak = computePrayerStreak(
      {
        "2026-08-13": ["on_time", "on_time", "on_time", "on_time", "on_time"],
        "2026-08-14": ["on_time", "on_time", "qada", "on_time", "on_time"],
        "2026-08-15": ["on_time", "on_time", "on_time", "on_time", "on_time"],
      },
      "2026-08-15"
    );
    expect(streak).toBe(1); // only 08-15; the qada day 08-14 cuts it off (positive control: all-on_time 08-13 exists)
    expect(isOnTimeDay(["on_time", "on_time", "qada", "on_time", "on_time"])).toBe(false);
    expect(isOnTimeDay(["on_time", "on_time", "on_time", "on_time", "on_time"])).toBe(true);
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

const day = (date: string, statuses: string[]) => statuses.map((status, i) => ({ date, prayer_name: ["fajr", "dhuhr", "asr", "maghrib", "isha"][i]!, status }));

describe("onTimeDaysFromRows", () => {
  it("keeps only days with all five distinct prayers on_time", () => {
    const rows = [
      ...day("2026-08-10", ["on_time", "on_time", "on_time", "on_time", "on_time"]),
      ...day("2026-08-11", ["on_time", "on_time", "qada", "on_time", "on_time"]),
      ...day("2026-08-12", ["on_time", "on_time", "on_time", "on_time"]),
      { date: "2026-08-13", prayer_name: "fajr", status: "on_time" },
      { date: "2026-08-13", prayer_name: "fajr", status: "on_time" }, // duplicate row must not fake a full day
    ];
    expect(onTimeDaysFromRows(rows)).toEqual(["2026-08-10"]);
  });
});

describe("computeLongestPrayerStreak", () => {
  it("is the longest consecutive run anywhere in history, not just the current one", () => {
    const days = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-06", "2026-01-07"];
    expect(computeLongestPrayerStreak(days)).toBe(4);
  });
  it("crosses month and year boundaries, ignores order and duplicates", () => {
    expect(computeLongestPrayerStreak(["2026-01-01", "2025-12-30", "2025-12-31", "2025-12-31"])).toBe(3);
  });
  it("is 0 with no on-time days and 1 for a single day", () => {
    expect(computeLongestPrayerStreak([])).toBe(0);
    expect(computeLongestPrayerStreak(["2026-03-03"])).toBe(1);
  });
  it("a streak longer than 60 days is not capped (the old 60-day window would have)", () => {
    const days = Array.from({ length: 90 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
    expect(computeLongestPrayerStreak(days)).toBe(90);
  });
});
