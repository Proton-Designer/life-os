import { describe, expect, it } from "vitest";
import { closeVsBedtime, formatClock, localMinutesOfDay, wakeSpread } from "../insights";

const TZ = "America/Chicago"; // CDT = UTC-5 in October
const at = (hhmmLocal: string, day = "2026-10-01") => {
  const [h, m] = hhmmLocal.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, Number(day.slice(8)), h! + 5, m!)).toISOString();
};

describe("localMinutesOfDay", () => {
  it("reads the zone's wall clock, not UTC", () => {
    expect(localMinutesOfDay("2026-10-02T02:30:00Z", TZ)).toBe(21 * 60 + 30); // 21:30 Chicago on the 1st
    expect(localMinutesOfDay("2026-10-02T02:30:00Z", "UTC")).toBe(2 * 60 + 30);
  });
});

describe("wakeSpread", () => {
  it("is null under 3 points (no number from two mornings)", () => {
    expect(wakeSpread([at("07:00"), at("07:10", "2026-10-02")], TZ)).toBeNull();
  });
  it("reports earliest/latest/spread/median", () => {
    expect(wakeSpread([at("06:30"), at("07:00", "2026-10-02"), at("08:00", "2026-10-03")], TZ)).toEqual({ n: 3, earliest: "06:30", latest: "08:00", spreadMinutes: 90, median: "07:00" });
  });
});

describe("closeVsBedtime", () => {
  const closes = (...t: string[]) => t.map((x, i) => at(x, `2026-10-0${i + 1}`));
  it("needs a bedtime and 3 points", () => {
    expect(closeVsBedtime(closes("22:00", "22:30"), "23:00", TZ)).toBeNull();
    expect(closeVsBedtime(closes("22:00", "22:30", "22:45"), null, TZ)).toBeNull();
  });
  it("counts closes at/before bedtime; a post-midnight close is LATE, not early", () => {
    // 22:00 (-60), 23:00 (0), 00:30 next day (+90) vs bedtime 23:00
    const r = closeVsBedtime([at("22:00"), at("23:00", "2026-10-02"), at("00:30", "2026-10-04")], "23:00", TZ)!;
    expect(r).toMatchObject({ n: 3, onTime: 2, medianMinutesLate: 0 });
    expect(closeVsBedtime([at("23:30"), at("23:45", "2026-10-02"), at("00:30", "2026-10-04")], "23:00", TZ)).toMatchObject({ onTime: 0, medianMinutesLate: 45 });
  });
});

describe("formatClock", () => {
  it("wraps and pads", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(1500)).toBe("01:00");
    expect(formatClock(-30)).toBe("23:30");
  });
});
