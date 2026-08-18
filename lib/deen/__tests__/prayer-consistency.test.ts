import { describe, expect, it } from "vitest";
import { buildPrayerConsistencyRows, computeOnTimeRate } from "../prayer-consistency";
import type { ResolvedDayStatuses } from "../prayer-status";

const RESOLVED: Record<string, ResolvedDayStatuses> = {
  "2026-08-14": { fajr: "on_time", dhuhr: "qada", asr: "missed", maghrib: "upcoming", isha: "upcoming" },
  "2026-08-15": { fajr: "missed", dhuhr: "pending", asr: "upcoming", maghrib: "upcoming", isha: "upcoming" },
};

describe("buildPrayerConsistencyRows", () => {
  it("builds one row per prayer, one cell per day, from the already-resolved effective statuses", () => {
    const rows = buildPrayerConsistencyRows(RESOLVED, ["2026-08-14", "2026-08-15"]);
    const fajr = rows.find((r) => r.label === "Fajr");
    expect(fajr?.cells).toEqual([
      { date: "2026-08-14", status: "on_time" },
      { date: "2026-08-15", status: "missed" },
    ]);
    const dhuhr = rows.find((r) => r.label === "Dhuhr");
    expect(dhuhr?.cells[0].status).toBe("qada");
    expect(dhuhr?.cells[1].status).toBe("pending");
  });

  it("always builds exactly 5 prayer rows, in Fajr..Isha order", () => {
    const rows = buildPrayerConsistencyRows({}, ["2026-08-14"]);
    expect(rows.map((r) => r.label)).toEqual(["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]);
  });

  it("falls back to pending for a date with no resolved entry", () => {
    const rows = buildPrayerConsistencyRows({}, ["2026-08-14"]);
    const fajr = rows.find((r) => r.label === "Fajr");
    expect(fajr?.cells[0].status).toBe("pending");
  });

  it("shows a genuinely-missed unlogged prayer as missed, not a generic pending default", () => {
    const rows = buildPrayerConsistencyRows(RESOLVED, ["2026-08-15"]);
    const fajr = rows.find((r) => r.label === "Fajr");
    expect(fajr?.cells[0].status).toBe("missed");
  });
});

describe("computeOnTimeRate", () => {
  const PRAYER_ROWS = [
    { date: "2026-08-14", prayer_name: "fajr", status: "on_time" },
    { date: "2026-08-14", prayer_name: "dhuhr", status: "qada" },
    { date: "2026-08-15", prayer_name: "fajr", status: "missed" },
  ];

  it("computes the percent of all prayer-slots in the window logged on_time", () => {
    // 2 on_time out of 3 logged prayer rows... but the rate is over every
    // slot in the window (days x 5), not just logged ones.
    const rate = computeOnTimeRate(PRAYER_ROWS, 2); // 2 days x 5 prayers = 10 slots
    expect(rate).toBe(10); // 1 on_time / 10 slots = 10%
  });

  it("returns 0 for an empty window", () => {
    expect(computeOnTimeRate([], 0)).toBe(0);
  });
});
