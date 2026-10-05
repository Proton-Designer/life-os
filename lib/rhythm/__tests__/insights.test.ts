import { describe, expect, it } from "vitest";
import { closeVsBedtime, formatClock, localMinutesOfDay, wakeSpread, wakeVsPlan, LATE_MINUTES } from "../insights";

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

describe("wakeVsPlan", () => {
  const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
  const marks = (...hhmm: string[]) => hhmm.map((t, i) => at(t, days[i]));

  it("is null without a plan or under 3 mornings (no number from two mornings)", () => {
    expect(wakeVsPlan(marks("08:00", "08:00", "08:00"), null, TZ)).toBeNull();
    expect(wakeVsPlan(marks("08:00", "08:00"), "06:30", TZ)).toBeNull();
  });

  it("reports the median lateness, how many mornings were clearly late, and a quarter-hour suggestion", () => {
    const r = wakeVsPlan(marks("07:45", "08:00", "07:30", "06:30", "08:15"), "06:30", TZ)!;
    expect(r.n).toBe(5);
    expect(r.medianMinutesLate).toBe(75); // diffs: 75, 90, 60, 0, 105 -> median 75
    expect(r.lateDays).toBe(4); // 0 min is not late
    expect(r.suggestedWake).toBe("07:45"); // 06:30 + 75 min
    expect(r.medianMinutesLate).toBeGreaterThanOrEqual(LATE_MINUTES);
  });

  it("rounds the suggested wake to the nearest 15 minutes", () => {
    expect(wakeVsPlan(marks("07:20", "07:20", "07:20"), "06:30", TZ)!.suggestedWake).toBe("07:15");
    expect(wakeVsPlan(marks("07:25", "07:25", "07:25"), "06:30", TZ)!.suggestedWake).toBe("07:30");
  });

  it("an on-time or early week has a median under the late threshold (the caller says nothing)", () => {
    expect(wakeVsPlan(marks("06:30", "06:40", "06:20"), "06:30", TZ)!.medianMinutesLate).toBeLessThan(LATE_MINUTES);
    expect(wakeVsPlan(marks("05:30", "05:45", "06:00"), "06:30", TZ)!.medianMinutesLate).toBeLessThan(0);
  });

  it("wraps across midnight like closeVsBedtime (a 00:20 start against a 23:50 plan is +30, not -23.5h)", () => {
    const r = wakeVsPlan([at("00:20", "2026-10-02"), at("00:20", "2026-10-03"), at("00:20", "2026-10-04")], "23:50", TZ)!;
    expect(r.medianMinutesLate).toBe(30);
  });
});

