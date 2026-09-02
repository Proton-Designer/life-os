import { describe, expect, it } from "vitest";
import { computeDayRibbon } from "../day-ribbon";

const FAJR_START = new Date("2026-08-15T09:12:00Z");
const FAJR_END = new Date("2026-08-15T10:30:00Z"); // sunrise
const DHUHR_START = new Date("2026-08-15T17:56:00Z");
const ASR_START = new Date("2026-08-15T21:49:00Z");
const MAGHRIB_START = new Date("2026-08-16T00:59:00Z");
const ISHA_START = new Date("2026-08-16T02:40:00Z");
const ISHA_END = new Date("2026-08-16T09:00:00Z"); // next day's Fajr

// A3 Part 1: the axis is wake -> sleep, independent of Faith/prayers. This
// fixture pins wake/sleep to exactly Fajr's window start and Isha's window
// end so every pre-existing pct-based assertion below (written when the
// range WAS derived from prayers) keeps the same expected numbers — only
// the SOURCE of the range changed, not its value, for these fixtures.
const DAY_BOUNDS = { start: FAJR_START, end: ISHA_END };

const PRAYERS = [
  { name: "fajr", label: "Fajr", window: { start: FAJR_START, end: FAJR_END }, status: "on_time" },
  { name: "dhuhr", label: "Dhuhr", window: { start: DHUHR_START, end: ASR_START }, status: "on_time" },
  { name: "asr", label: "Asr", window: { start: ASR_START, end: MAGHRIB_START }, status: "pending" },
  { name: "maghrib", label: "Maghrib", window: { start: MAGHRIB_START, end: ISHA_START }, status: "missed" },
  { name: "isha", label: "Isha", window: { start: ISHA_START, end: ISHA_END }, status: "upcoming" },
] as const;

describe("computeDayRibbon", () => {
  // A3 Part 1: the day axis is wake -> sleep. Without Faith (or without
  // location) there are no placeable prayers, but the axis must still
  // exist — this is the exact regression the old "no prayers -> null"
  // contract would have caused: "no location gate ... for a user who did
  // not pick Faith" (BOSS-VISION §4b rule 1). null is now ONLY a dayBounds
  // signal, never a prayer-availability one.
  it("still produces a valid ribbon with zero prayer spans when there are no prayers at all (no location set)", () => {
    const layout = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: [], activities: [], now: FAJR_START });
    expect(layout).not.toBeNull();
    expect(layout?.spans).toHaveLength(0);
    expect(layout?.rangeStart).toEqual(DAY_BOUNDS.start);
    expect(layout?.rangeEnd).toEqual(DAY_BOUNDS.end);
  });

  it("still produces a valid ribbon with zero prayer spans when every prayer's window is null (cannot determine)", () => {
    const allNull = PRAYERS.map((p) => ({ ...p, window: null }));
    const layout = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: allNull, activities: [], now: FAJR_START });
    expect(layout).not.toBeNull();
    expect(layout?.spans).toHaveLength(0);
  });

  // The trap named in AGENTS.md's timezone entry and repeated for this
  // exact case: a zero-width (or collapsed) range must never happen
  // silently. Two distinct cases, not one:
  describe("wake/sleep bounds — the trap", () => {
    it("treats sleep <= wake as a real overnight rhythm (+24h), not an error — a night-shift user is a user", () => {
      const wake = new Date("2026-08-15T23:00:00-05:00"); // 23:00 local
      const sleep = new Date("2026-08-15T06:00:00-05:00"); // 06:00 local, same calendar day as stored
      const layout = computeDayRibbon({ dayBounds: { start: wake, end: sleep }, prayers: [], activities: [], now: wake });
      expect(layout).not.toBeNull();
      expect(layout!.rangeStart).toEqual(wake);
      expect(layout!.rangeEnd.getTime()).toBe(sleep.getTime() + 24 * 60 * 60 * 1000);
      expect(layout!.rangeEnd.getTime() - layout!.rangeStart.getTime()).toBe(7 * 60 * 60 * 1000);
    });

    it("returns null (never a zero-width layout) when wake and sleep are exactly the same instant", () => {
      const same = new Date("2026-08-15T08:00:00Z");
      const layout = computeDayRibbon({ dayBounds: { start: same, end: same }, prayers: [], activities: [], now: same });
      expect(layout).toBeNull();
    });
  });

  it("spans Fajr's window start to Isha's window end as the 0-100% range", () => {
    const layout = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    expect(layout?.rangeStart).toEqual(FAJR_START);
    expect(layout?.rangeEnd).toEqual(ISHA_END);
    expect(layout?.spans[0].startPct).toBe(0);
    expect(layout?.spans[layout.spans.length - 1].endPct).toBe(100);
  });

  it("renders each prayer as a span (window.start to window.end), not a point", () => {
    const layout = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    const asrSpan = layout?.spans.find((s) => s.name === "asr");
    expect(asrSpan?.startPct).toBeLessThan(asrSpan!.endPct);
  });

  it("maps on_time and qada to the logged state", () => {
    const layout = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    expect(layout?.spans.find((s) => s.name === "fajr")?.state).toBe("logged");

    const withQada = PRAYERS.map((p) => (p.name === "dhuhr" ? { ...p, status: "qada" as const } : p));
    const layout2 = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: withQada, activities: [], now: DHUHR_START });
    expect(layout2?.spans.find((s) => s.name === "dhuhr")?.state).toBe("logged");
  });

  it("maps missed to the missed state — a closed-and-unlogged prayer never reads as upcoming", () => {
    const layout = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    expect(layout?.spans.find((s) => s.name === "maghrib")?.state).toBe("missed");
  });

  it("maps pending (window open, unlogged) to its own live state, distinct from upcoming", () => {
    const layout = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    expect(layout?.spans.find((s) => s.name === "asr")?.state).toBe("pending");
  });

  it("maps upcoming (window not yet open) to the upcoming state", () => {
    const layout = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    expect(layout?.spans.find((s) => s.name === "isha")?.state).toBe("upcoming");
  });

  it("omits a prayer with a null window from spans (cannot be placed) without crashing", () => {
    const withNullFajr = PRAYERS.map((p) => (p.name === "fajr" ? { ...p, window: null } : p));
    const layout = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: withNullFajr, activities: [], now: DHUHR_START });
    expect(layout?.spans.find((s) => s.name === "fajr")).toBeUndefined();
    expect(layout?.spans).toHaveLength(4);
  });

  it("computes the 'now' position as a percent within range, clamped to [0,100]", () => {
    const layout = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    expect(layout?.nowPct).toBeGreaterThan(0);
    expect(layout?.nowPct).toBeLessThan(100);
    expect(layout?.nowPosition).toBe("within");
  });

  it("reports nowPosition as before/after rather than silently clamping — no defined on-track behavior outside range", () => {
    const before = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: [...PRAYERS], activities: [], now: new Date("2026-08-15T00:00:00Z") });
    expect(before?.nowPosition).toBe("before");
    expect(before?.nowPct).toBe(0);

    const after = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: [...PRAYERS], activities: [], now: new Date("2026-08-17T00:00:00Z") });
    expect(after?.nowPosition).toBe("after");
    expect(after?.nowPct).toBe(100);
  });

  it("carries the raw 'now' Date through so the caller can format a real 'time until/since' label", () => {
    const layout = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: [...PRAYERS], activities: [], now: DHUHR_START });
    expect(layout?.now).toEqual(DHUHR_START);
  });

  it("positions activity blocks by their real start/end timestamps", () => {
    const layout = computeDayRibbon({
      dayBounds: DAY_BOUNDS,
      prayers: [...PRAYERS],
      activities: [{ label: "Deep work", colorVar: "--series-business", kind: "focus", start: DHUHR_START, end: ASR_START }],
      now: ISHA_START,
    });
    const dhuhrSpan = layout?.spans.find((s) => s.name === "dhuhr");
    const asrSpan = layout?.spans.find((s) => s.name === "asr");
    expect(layout?.blocks[0].startPct).toBe(dhuhrSpan?.startPct);
    expect(layout?.blocks[0].endPct).toBe(asrSpan?.startPct);
  });

  it("clamps an ongoing (no end yet) activity block to 'now'", () => {
    const layout = computeDayRibbon({
      dayBounds: DAY_BOUNDS,
      prayers: [...PRAYERS],
      activities: [{ label: "Lock-In", colorVar: "--series-business", kind: "focus", start: DHUHR_START, end: null }],
      now: ASR_START,
    });
    expect(layout?.blocks[0].endPct).toBe(layout?.nowPct);
  });

  it("clamps activity block positions that fall outside the range", () => {
    const layout = computeDayRibbon({
      dayBounds: DAY_BOUNDS,
      prayers: [...PRAYERS],
      activities: [
        {
          label: "Late night",
          colorVar: "--series-noise",
          kind: "task",
          start: new Date("2026-08-16T10:00:00Z"),
          end: new Date("2026-08-16T11:00:00Z"),
        },
      ],
      now: ISHA_START,
    });
    expect(layout?.blocks[0].startPct).toBe(100);
    expect(layout?.blocks[0].endPct).toBe(100);
  });

  // Prayers are now a clamped anchor provider, not the range's source —
  // a prayer window that falls outside dayBounds must clamp like an
  // activity block does, never crash or silently extend the range.
  it("clamps a prayer span that falls outside dayBounds instead of extending the range", () => {
    const outside = [
      ...PRAYERS.filter((p) => p.name !== "isha"),
      { name: "isha" as const, label: "Isha", window: { start: new Date("2026-08-16T12:00:00Z"), end: new Date("2026-08-16T13:00:00Z") }, status: "upcoming" as const },
    ];
    const layout = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: outside, activities: [], now: DHUHR_START });
    expect(layout?.rangeEnd).toEqual(ISHA_END); // range unchanged by the out-of-bounds prayer
    const ishaSpan = layout?.spans.find((s) => s.name === "isha");
    expect(ishaSpan?.startPct).toBe(100);
    expect(ishaSpan?.endPct).toBe(100);
  });

  // 2026-08-25/26 batch 2, item 1a: "list main event's in order of
  // occurance." get-day-shape.ts builds `activities` grouped by SOURCE
  // (workout, then tasks, then focus, then schedule events) — this must
  // re-sort by real start time regardless of input order, since positions
  // (startPct) are already correct independent of array order but DOM/
  // reading order should still match the day's actual chronology.
  it("sorts blocks by real start time, independent of the input activities' own order", () => {
    const early = { label: "Early class", colorVar: "--series-school", kind: "class" as const, start: FAJR_START, end: FAJR_END };
    const middle = { label: "Deep work", colorVar: "--series-business", kind: "focus" as const, start: DHUHR_START, end: ASR_START };
    const late = { label: "Work", colorVar: "--series-coop", kind: "work" as const, start: ASR_START, end: MAGHRIB_START };
    // Deliberately fed out of chronological order (late, early, middle).
    const layout = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: [...PRAYERS], activities: [late, early, middle], now: ISHA_START });
    expect(layout?.blocks.map((b) => b.label)).toEqual(["Early class", "Deep work", "Work"]);
  });

  it("keeps a stable order for two blocks with the exact same start time", () => {
    const detail = { title: "CS-3341-HON", timeRange: "8:30 AM–9:45 AM", location: "ECSN 2.120", instructor: "N. Ruozzi", domain: "school" };
    const layout = computeDayRibbon({
      dayBounds: DAY_BOUNDS,
      prayers: [...PRAYERS],
      activities: [
        { label: "CS-3341-HON", colorVar: "--series-school", kind: "class", start: DHUHR_START, end: ASR_START, detail },
        { label: "Focus session", colorVar: "--series-business", kind: "focus", start: DHUHR_START, end: ASR_START },
      ],
      now: ISHA_START,
    });
    expect(layout?.blocks.map((b) => b.label)).toEqual(["CS-3341-HON", "Focus session"]);
  });

  it("passes an activity's detail payload through to its block, and leaves it undefined when absent", () => {
    const detail = { title: "CS-3341-HON", timeRange: "8:30 AM–9:45 AM", location: "ECSN 2.120", instructor: "N. Ruozzi", domain: "school" };
    const layout = computeDayRibbon({
      dayBounds: DAY_BOUNDS,
      prayers: [...PRAYERS],
      activities: [
        { label: "CS-3341-HON", colorVar: "--series-school", kind: "class", start: DHUHR_START, end: ASR_START, detail },
        { label: "Focus session", colorVar: "--series-business", kind: "focus", start: DHUHR_START, end: ASR_START },
      ],
      now: ISHA_START,
    });
    expect(layout?.blocks[0].detail).toEqual(detail);
    expect(layout?.blocks[1].detail).toBeUndefined();
  });

  // Ayman's report, 2026-08-24: Asr's and Maghrib's labels rendered on top
  // of each other, reading as one merged "AsrMaghrib" string — his real
  // prayer times for that day.
  describe("prayer label collision avoidance (labelRow)", () => {
    it("bumps Maghrib's label to the second row when its midpoint lands close to Asr's — Ayman's real case", () => {
      const bounds = { start: new Date("2026-08-24T05:45:00Z"), end: new Date("2026-08-25T05:44:00Z") };
      const layout = computeDayRibbon({
        dayBounds: bounds,
        prayers: [
          { name: "fajr", label: "Fajr", status: "on_time", window: { start: new Date("2026-08-24T05:45:00Z"), end: new Date("2026-08-24T13:30:00Z") } },
          { name: "dhuhr", label: "Dhuhr", status: "on_time", window: { start: new Date("2026-08-24T13:30:00Z"), end: new Date("2026-08-24T18:11:00Z") } },
          { name: "asr", label: "Asr", status: "on_time", window: { start: new Date("2026-08-24T18:11:00Z"), end: new Date("2026-08-24T20:03:00Z") } },
          { name: "maghrib", label: "Maghrib", status: "on_time", window: { start: new Date("2026-08-24T20:03:00Z"), end: new Date("2026-08-24T21:33:00Z") } },
          { name: "isha", label: "Isha", status: "upcoming", window: { start: new Date("2026-08-24T21:33:00Z"), end: new Date("2026-08-25T05:44:00Z") } },
        ],
        activities: [],
        now: new Date("2026-08-24T19:00:00Z"),
      });
      const rowByName = Object.fromEntries(layout!.spans.map((s) => [s.name, s.labelRow]));
      expect(rowByName.fajr).toBe(0);
      expect(rowByName.dhuhr).toBe(0);
      expect(rowByName.asr).toBe(0);
      expect(rowByName.maghrib).toBe(1); // the exact pair Ayman reported
      expect(rowByName.isha).toBe(0);
    });

    it("a single placeable span always renders on row 0", () => {
      const onlyFajr = PRAYERS.map((p) => (p.name === "fajr" ? p : { ...p, window: null }));
      const layout = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: onlyFajr, activities: [], now: FAJR_START });
      expect(layout?.spans).toHaveLength(1);
      expect(layout?.spans[0].labelRow).toBe(0);
    });

    it("alternates rows through a run of three consecutive too-close labels", () => {
      // Fajr and Isha keep the overall range wide (a full day) so Dhuhr/Asr/
      // Maghrib's 5-minute-apart cluster in the middle is genuinely tight
      // as a PERCENT of the range — three real prayers crammed into one
      // small window is the realistic version of "too close," not three
      // prayers spanning the whole range by themselves.
      const tight = computeDayRibbon({
        dayBounds: DAY_BOUNDS,
        prayers: [
          { name: "fajr", label: "Fajr", status: "on_time", window: { start: FAJR_START, end: FAJR_END } },
          { name: "dhuhr", label: "Dhuhr", status: "on_time", window: { start: new Date("2026-08-15T15:00:00Z"), end: new Date("2026-08-15T15:05:00Z") } },
          { name: "asr", label: "Asr", status: "on_time", window: { start: new Date("2026-08-15T15:05:00Z"), end: new Date("2026-08-15T15:10:00Z") } },
          { name: "maghrib", label: "Maghrib", status: "on_time", window: { start: new Date("2026-08-15T15:10:00Z"), end: new Date("2026-08-15T15:15:00Z") } },
          { name: "isha", label: "Isha", status: "upcoming", window: { start: ISHA_START, end: ISHA_END } },
        ],
        activities: [],
        now: DHUHR_START,
      });
      expect(tight?.spans.map((s) => s.labelRow)).toEqual([0, 0, 1, 0, 0]);
    });

    it("alternates rows across all five spans sharing the exact same midpoint", () => {
      const sameWindow = { start: new Date("2026-08-24T13:00:00Z"), end: new Date("2026-08-24T13:10:00Z") };
      const identical = PRAYERS.map((p) => ({ ...p, window: sameWindow }));
      const layout = computeDayRibbon({ dayBounds: DAY_BOUNDS, prayers: identical, activities: [], now: new Date("2026-08-24T13:00:00Z") });
      expect(layout?.spans.map((s) => s.labelRow)).toEqual([0, 1, 0, 1, 0]);
    });
  });
});
