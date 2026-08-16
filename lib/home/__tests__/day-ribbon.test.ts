import { describe, expect, it } from "vitest";
import { computeDayRibbon } from "../day-ribbon";

const FAJR = new Date("2026-08-15T09:12:00Z"); // 5:12 local-ish, treated as UTC for test simplicity
const DHUHR = new Date("2026-08-15T17:56:00Z");
const ASR = new Date("2026-08-15T21:49:00Z");
const MAGHRIB = new Date("2026-08-16T00:59:00Z");
const ISHA = new Date("2026-08-16T02:40:00Z");

const PRAYERS = [
  { name: "fajr", label: "Fajr", time: FAJR, status: "on_time" },
  { name: "dhuhr", label: "Dhuhr", time: DHUHR, status: "on_time" },
  { name: "asr", label: "Asr", time: ASR, status: "pending" },
  { name: "maghrib", label: "Maghrib", time: MAGHRIB, status: "missed" },
  { name: "isha", label: "Isha", time: ISHA, status: "pending" },
];

describe("computeDayRibbon", () => {
  it("returns null when prayer times aren't available (no location set)", () => {
    expect(computeDayRibbon({ prayers: [], activities: [], now: FAJR })).toBeNull();
  });

  it("spans Fajr to Isha as the 0-100% range", () => {
    const layout = computeDayRibbon({ prayers: PRAYERS, activities: [], now: DHUHR });
    expect(layout?.rangeStart).toEqual(FAJR);
    expect(layout?.rangeEnd).toEqual(ISHA);
    expect(layout?.markers[0].pct).toBe(0);
    expect(layout?.markers[4].pct).toBe(100);
  });

  it("marks logged prayers (on_time/qada) as filled, missed as ringed, pending as hollow", () => {
    const layout = computeDayRibbon({ prayers: PRAYERS, activities: [], now: DHUHR });
    expect(layout?.markers.find((m) => m.name === "fajr")?.state).toBe("logged");
    expect(layout?.markers.find((m) => m.name === "maghrib")?.state).toBe("missed");
    expect(layout?.markers.find((m) => m.name === "asr")?.state).toBe("upcoming");
  });

  it("computes the 'now' position as a percent within range, clamped to [0,100]", () => {
    const layout = computeDayRibbon({ prayers: PRAYERS, activities: [], now: DHUHR });
    expect(layout?.nowPct).toBeGreaterThan(0);
    expect(layout?.nowPct).toBeLessThan(100);

    // before Fajr and after Isha both clamp rather than going out of range
    const before = computeDayRibbon({ prayers: PRAYERS, activities: [], now: new Date("2026-08-15T00:00:00Z") });
    expect(before?.nowPct).toBe(0);
    const after = computeDayRibbon({ prayers: PRAYERS, activities: [], now: new Date("2026-08-17T00:00:00Z") });
    expect(after?.nowPct).toBe(100);
  });

  it("positions activity blocks by their real start/end timestamps", () => {
    const layout = computeDayRibbon({
      prayers: PRAYERS,
      activities: [
        { label: "Deep work", colorVar: "--series-business", start: DHUHR, end: ASR },
      ],
      now: ISHA,
    });
    expect(layout?.blocks[0].startPct).toBe(layout?.markers.find((m) => m.name === "dhuhr")?.pct);
    expect(layout?.blocks[0].endPct).toBe(layout?.markers.find((m) => m.name === "asr")?.pct);
  });

  it("clamps an ongoing (no end yet) activity block to 'now'", () => {
    const layout = computeDayRibbon({
      prayers: PRAYERS,
      activities: [{ label: "Lock-In", colorVar: "--series-business", start: DHUHR, end: null }],
      now: ASR,
    });
    expect(layout?.blocks[0].endPct).toBe(layout?.nowPct);
  });

  it("clamps activity block positions that fall outside the Fajr-Isha range", () => {
    const layout = computeDayRibbon({
      prayers: PRAYERS,
      activities: [
        { label: "Late night", colorVar: "--series-noise", start: new Date("2026-08-16T04:00:00Z"), end: new Date("2026-08-16T05:00:00Z") },
      ],
      now: ISHA,
    });
    expect(layout?.blocks[0].startPct).toBe(100);
    expect(layout?.blocks[0].endPct).toBe(100);
  });
});
