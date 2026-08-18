import { describe, expect, it } from "vitest";
import { computeDayRibbon } from "../day-ribbon";

const FAJR_START = new Date("2026-08-15T09:12:00Z");
const FAJR_END = new Date("2026-08-15T10:30:00Z"); // sunrise
const DHUHR_START = new Date("2026-08-15T17:56:00Z");
const ASR_START = new Date("2026-08-15T21:49:00Z");
const MAGHRIB_START = new Date("2026-08-16T00:59:00Z");
const ISHA_START = new Date("2026-08-16T02:40:00Z");
const ISHA_END = new Date("2026-08-16T09:00:00Z"); // next day's Fajr

const PRAYERS = [
  { name: "fajr", label: "Fajr", window: { start: FAJR_START, end: FAJR_END }, status: "on_time" },
  { name: "dhuhr", label: "Dhuhr", window: { start: DHUHR_START, end: ASR_START }, status: "on_time" },
  { name: "asr", label: "Asr", window: { start: ASR_START, end: MAGHRIB_START }, status: "pending" },
  { name: "maghrib", label: "Maghrib", window: { start: MAGHRIB_START, end: ISHA_START }, status: "missed" },
  { name: "isha", label: "Isha", window: { start: ISHA_START, end: ISHA_END }, status: "upcoming" },
] as const;

describe("computeDayRibbon", () => {
  it("returns null when there are no prayers at all (no location set)", () => {
    expect(computeDayRibbon({ prayers: [], activities: [], now: FAJR_START })).toBeNull();
  });

  it("returns null when every prayer's window is null (cannot determine — never a lying layout)", () => {
    const allNull = PRAYERS.map((p) => ({ ...p, window: null }));
    expect(computeDayRibbon({ prayers: allNull, activities: [], now: FAJR_START })).toBeNull();
  });

  it("spans Fajr's window start to Isha's window end as the 0-100% range", () => {
    const layout = computeDayRibbon({ prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    expect(layout?.rangeStart).toEqual(FAJR_START);
    expect(layout?.rangeEnd).toEqual(ISHA_END);
    expect(layout?.spans[0].startPct).toBe(0);
    expect(layout?.spans[layout.spans.length - 1].endPct).toBe(100);
  });

  it("renders each prayer as a span (window.start to window.end), not a point", () => {
    const layout = computeDayRibbon({ prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    const asrSpan = layout?.spans.find((s) => s.name === "asr");
    expect(asrSpan?.startPct).toBeLessThan(asrSpan!.endPct);
  });

  it("maps on_time and qada to the logged state", () => {
    const layout = computeDayRibbon({ prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    expect(layout?.spans.find((s) => s.name === "fajr")?.state).toBe("logged");

    const withQada = PRAYERS.map((p) => (p.name === "dhuhr" ? { ...p, status: "qada" as const } : p));
    const layout2 = computeDayRibbon({ prayers: withQada, activities: [], now: DHUHR_START });
    expect(layout2?.spans.find((s) => s.name === "dhuhr")?.state).toBe("logged");
  });

  it("maps missed to the missed state — a closed-and-unlogged prayer never reads as upcoming", () => {
    const layout = computeDayRibbon({ prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    expect(layout?.spans.find((s) => s.name === "maghrib")?.state).toBe("missed");
  });

  it("maps pending (window open, unlogged) to its own live state, distinct from upcoming", () => {
    const layout = computeDayRibbon({ prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    expect(layout?.spans.find((s) => s.name === "asr")?.state).toBe("pending");
  });

  it("maps upcoming (window not yet open) to the upcoming state", () => {
    const layout = computeDayRibbon({ prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    expect(layout?.spans.find((s) => s.name === "isha")?.state).toBe("upcoming");
  });

  it("omits a prayer with a null window from spans (cannot be placed) without crashing", () => {
    const withNullFajr = PRAYERS.map((p) => (p.name === "fajr" ? { ...p, window: null } : p));
    const layout = computeDayRibbon({ prayers: withNullFajr, activities: [], now: DHUHR_START });
    expect(layout?.spans.find((s) => s.name === "fajr")).toBeUndefined();
    expect(layout?.spans).toHaveLength(4);
  });

  it("computes the 'now' position as a percent within range, clamped to [0,100]", () => {
    const layout = computeDayRibbon({ prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    expect(layout?.nowPct).toBeGreaterThan(0);
    expect(layout?.nowPct).toBeLessThan(100);
    expect(layout?.nowPosition).toBe("within");
  });

  it("reports nowPosition as before/after rather than silently clamping — no defined on-track behavior outside range", () => {
    const before = computeDayRibbon({ prayers: [...PRAYERS], activities: [], now: new Date("2026-08-15T00:00:00Z") });
    expect(before?.nowPosition).toBe("before");
    expect(before?.nowPct).toBe(0);

    const after = computeDayRibbon({ prayers: [...PRAYERS], activities: [], now: new Date("2026-08-17T00:00:00Z") });
    expect(after?.nowPosition).toBe("after");
    expect(after?.nowPct).toBe(100);
  });

  it("carries the raw 'now' Date through so the caller can format a real 'time until/since' label", () => {
    const layout = computeDayRibbon({ prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    expect(layout?.now).toEqual(DHUHR_START);
  });

  it("positions activity blocks by their real start/end timestamps", () => {
    const layout = computeDayRibbon({
      prayers: [...PRAYERS],
      activities: [{ label: "Deep work", colorVar: "--series-business", start: DHUHR_START, end: ASR_START }],
      now: ISHA_START,
    });
    const dhuhrSpan = layout?.spans.find((s) => s.name === "dhuhr");
    const asrSpan = layout?.spans.find((s) => s.name === "asr");
    expect(layout?.blocks[0].startPct).toBe(dhuhrSpan?.startPct);
    expect(layout?.blocks[0].endPct).toBe(asrSpan?.startPct);
  });

  it("clamps an ongoing (no end yet) activity block to 'now'", () => {
    const layout = computeDayRibbon({
      prayers: [...PRAYERS],
      activities: [{ label: "Lock-In", colorVar: "--series-business", start: DHUHR_START, end: null }],
      now: ASR_START,
    });
    expect(layout?.blocks[0].endPct).toBe(layout?.nowPct);
  });

  it("clamps activity block positions that fall outside the range", () => {
    const layout = computeDayRibbon({
      prayers: [...PRAYERS],
      activities: [
        {
          label: "Late night",
          colorVar: "--series-noise",
          start: new Date("2026-08-16T10:00:00Z"),
          end: new Date("2026-08-16T11:00:00Z"),
        },
      ],
      now: ISHA_START,
    });
    expect(layout?.blocks[0].startPct).toBe(100);
    expect(layout?.blocks[0].endPct).toBe(100);
  });
});
