import { describe, expect, it } from "vitest";
import { buildDayBar, dayBarEnd, formatAwake, toGoLabel } from "../day-bar";
import { computeDayRibbon } from "../day-ribbon";
import { HOME_DAY_VIEW } from "../day-view";

const CHI = "America/Chicago";
const at = (l: string) => new Date(`${l}-05:00`); // CDT
const WAKE = at("2026-10-05T06:00:00");
const END = at("2026-10-05T22:00:00"); // 16 h bar

const layout = computeDayRibbon({
  dayBounds: { start: at("2026-10-05T05:00:00"), end: at("2026-10-05T23:00:00") },
  prayers: [],
  activities: [
    { label: "Calc", colorVar: "--accent-school", kind: "class", start: at("2026-10-05T10:00:00"), end: at("2026-10-05T11:00:00") },
    { label: "Lock-In", colorVar: "--accent-business", kind: "focus", start: at("2026-10-05T08:00:00"), end: at("2026-10-05T09:30:00") },
    { label: "Early", colorVar: "--accent-school", kind: "class", start: at("2026-10-05T05:10:00"), end: at("2026-10-05T05:40:00") },
    { label: "Late", colorVar: "--accent-school", kind: "work", start: at("2026-10-05T22:30:00"), end: at("2026-10-05T23:00:00") },
    { label: "Evening gym", colorVar: "--accent-fitness", kind: "fitness", start: at("2026-10-05T18:00:00"), end: at("2026-10-05T19:00:00") },
  ],
  now: at("2026-10-05T12:00:00"),
})!;

describe("HOME_DAY_VIEW (the one switch)", () => {
  it("defaults to the Day bar; the other value is 'classic'", () => {
    expect(HOME_DAY_VIEW).toBe("bar");
  });
});

describe("dayBarEnd", () => {
  const base = { wake: WAKE, ribbonEnd: at("2026-10-05T23:00:00"), localDate: "2026-10-05", timezone: CHI };
  it("no plan: the ribbon's own end of day", () => {
    expect(dayBarEnd({ ...base, bedtime: null }).getTime()).toBe(base.ribbonEnd.getTime());
  });
  it("a wind-down bedtime ends the bar there (positive control: it differs from the ribbon end)", () => {
    expect(dayBarEnd({ ...base, bedtime: "22:30" }).getTime()).toBe(at("2026-10-05T22:30:00").getTime());
  });
  it("a post-midnight bedtime is the NEXT calendar day", () => {
    expect(dayBarEnd({ ...base, bedtime: "00:30" }).getTime()).toBe(at("2026-10-06T00:30:00").getTime());
  });
  // eng1 review L5: "+24 h" is an hour off across a DST change; the next day's bedtime is resolved on that date.
  it("a post-midnight bedtime across the fall-back DST change lands on the real local 00:30 (positive control: +24 h would not)", () => {
    const wake = new Date("2026-11-01T06:00:00-05:00"); // Nov 1, CDT; clocks fall back at 02:00 that night
    const localDate = "2026-11-01";
    const end = dayBarEnd({ wake, ribbonEnd: new Date("2026-11-02T04:00:00-06:00"), bedtime: "00:30", localDate, timezone: CHI });
    expect(end.toISOString()).toBe(new Date("2026-11-02T00:30:00-06:00").toISOString()); // CST
    const naive = new Date(new Date("2026-11-01T00:30:00-05:00").getTime() + 24 * 3600_000); // the old +24 h
    expect(naive.toISOString()).not.toBe(end.toISOString());
  });
  it("never shorter than an hour after wake", () => {
    expect(dayBarEnd({ ...base, ribbonEnd: new Date(WAKE.getTime() + 60_000), bedtime: null }).getTime()).toBe(WAKE.getTime() + 3600_000);
  });
});

describe("buildDayBar", () => {
  const bar = buildDayBar({ layout, wake: WAKE, end: END, now: at("2026-10-05T14:00:00"), efficiencyPercent: 30 });

  it("re-projects blocks onto the wake→bedtime range (class 10:00-11:00 of 16 h = 25%→31.25%)", () => {
    const calc = bar.blocks.find((b) => b.label === "Calc")!;
    expect(calc.startPct).toBeCloseTo(25, 1);
    expect(calc.endPct).toBeCloseTo(31.25, 1);
  });
  it("drops blocks entirely before wake or after the end (positive control: the ones inside stay)", () => {
    const labels = bar.blocks.map((b) => b.label);
    expect(labels).not.toContain("Early");
    expect(labels).not.toContain("Late");
    expect(labels).toEqual(expect.arrayContaining(["Calc", "Lock-In", "Evening gym"]));
  });
  it("awake-so-far is wake→now (8 h of 16 = 50%) and the efficiency share is 30% of THAT span", () => {
    expect(bar.awakePct).toBeCloseTo(50, 1);
    expect(bar.focusSharePct).toBeCloseTo(15, 1);
    expect(bar.nowPosition).toBe("within");
  });
  it("highlights focus blocks and marks what is after NOW as upcoming", () => {
    expect(bar.blocks.find((b) => b.label === "Lock-In")!.isFocus).toBe(true);
    expect(bar.blocks.find((b) => b.label === "Calc")!.isFocus).toBe(false);
    expect(bar.blocks.find((b) => b.label === "Evening gym")!.upcoming).toBe(true);
    expect(bar.blocks.find((b) => b.label === "Calc")!.upcoming).toBe(false);
  });
  it("null efficiency = no focus share; now before wake = nothing awake; after the end = parked, not silently clamped", () => {
    expect(buildDayBar({ layout, wake: WAKE, end: END, now: at("2026-10-05T14:00:00"), efficiencyPercent: null }).focusSharePct).toBe(0);
    const before = buildDayBar({ layout, wake: WAKE, end: END, now: at("2026-10-05T05:00:00"), efficiencyPercent: 50 });
    expect(before.awakePct).toBe(0);
    expect(before.nowPosition).toBe("before");
    expect(buildDayBar({ layout, wake: WAKE, end: END, now: at("2026-10-06T01:00:00"), efficiencyPercent: 50 }).nowPosition).toBe("after");
  });
  it("works with no ribbon at all (no blocks, still a bar)", () => {
    const b = buildDayBar({ layout: null, wake: WAKE, end: END, now: at("2026-10-05T14:00:00"), efficiencyPercent: 10 });
    expect(b.blocks).toEqual([]);
    expect(b.awakePct).toBeCloseTo(50, 1);
  });
});

describe("labels", () => {
  it("Awake for h:mm", () => {
    expect(formatAwake(5 * 3600 + 45 * 60 + 30)).toBe("5:45");
    expect(formatAwake(-5)).toBe("0:00");
  });
  it("'to go' only while under the target", () => {
    const fmt = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
    expect(toGoLabel(90, 240, fmt)).toBe("2:30 to go");
    expect(toGoLabel(240, 240, fmt)).toBeNull();
    expect(toGoLabel(300, 240, fmt)).toBeNull();
  });
});

// DAYBAR-02: prayer bands, lanes, tiny events, popover data, the hour scale, generic calendar events.
describe("DAYBAR-02 model", () => {
  const NOW = at("2026-10-05T14:00:00");
  const withPrayer = computeDayRibbon({
    dayBounds: { start: at("2026-10-05T05:00:00"), end: at("2026-10-05T23:00:00") },
    prayers: [
      { name: "fajr", label: "Fajr", status: "on_time", window: { start: at("2026-10-05T05:00:00"), end: at("2026-10-05T06:30:00") } },
      { name: "dhuhr", label: "Dhuhr", status: "pending", window: { start: at("2026-10-05T13:00:00"), end: at("2026-10-05T15:30:00") } },
      { name: "isha", label: "Isha", status: "upcoming", window: { start: at("2026-10-05T21:00:00"), end: at("2026-10-05T23:30:00") } },
    ],
    activities: [
      { label: "Calc", colorVar: "--c", kind: "class", start: at("2026-10-05T10:00:00"), end: at("2026-10-05T11:30:00"), detail: { title: "Calculus", timeRange: "x", location: "Room 4", instructor: "Dr. Lee", domain: "school" } },
      { label: "Chem", colorVar: "--c", kind: "class", start: at("2026-10-05T10:30:00"), end: at("2026-10-05T12:00:00") }, // overlaps Calc
      { label: "Call", colorVar: "--c", kind: "task", start: at("2026-10-05T16:00:00"), end: at("2026-10-05T16:05:00") }, // tiny
      { label: "Shift", colorVar: "--c", kind: "work", start: at("2026-10-05T12:00:00"), end: at("2026-10-05T14:00:00") },
    ],
    now: NOW,
  })!;
  const bar = buildDayBar({ layout: withPrayer, wake: WAKE, end: END, now: NOW, efficiencyPercent: 20, timezone: CHI });

  it("prayer WINDOWS become bands (start/end clipped to the bar, current marked), and none exist when there are no spans (Deen OFF)", () => {
    const dhuhr = bar.prayers.find((p) => p.name === "dhuhr")!;
    expect(dhuhr.startPct).toBeCloseTo(43.75, 1);
    expect(dhuhr.endPct).toBeCloseTo(59.375, 1);
    expect(dhuhr.current).toBe(true);
    const fajr = bar.prayers.find((p) => p.name === "fajr")!; // 05:00-06:30 starts before the 06:00 wake: clipped to 0
    expect(fajr.startPct).toBe(0);
    expect(fajr.current).toBe(false);
    const isha = bar.prayers.find((p) => p.name === "isha")!; // runs past the 22:00 end: clipped to 100
    expect(isha.endPct).toBe(100);
    const none = buildDayBar({ layout: { ...withPrayer, spans: [] }, wake: WAKE, end: END, now: NOW, efficiencyPercent: null });
    expect(none.prayers).toEqual([]);
  });

  it("overlapping fixed events stack into a second lane; non-overlapping ones share lane 0", () => {
    const lane = (label: string) => bar.blocks.find((b) => b.label === label)!.lane;
    expect(lane("Calc")).toBe(0);
    expect(lane("Chem")).toBe(1); // collides with Calc
    expect(lane("Shift")).toBe(0); // starts after Calc's footprint ended... Calc ends 11:30, Shift 12:00
    expect(bar.laneCount).toBe(2);
  });

  it("a tiny event is flagged so it renders as a dot; a normal one is not", () => {
    expect(bar.blocks.find((b) => b.label === "Call")!.tiny).toBe(true);
    expect(bar.blocks.find((b) => b.label === "Calc")!.tiny).toBe(false);
  });

  it("every block carries popover data: kind, title, time range, location/instructor", () => {
    const calc = bar.blocks.find((b) => b.label === "Calc")!.popover;
    expect(calc).toMatchObject({ kindLabel: "Class", title: "Calculus", location: "Room 4", instructor: "Dr. Lee" });
    expect(calc.endAt!.getTime() - calc.startAt.getTime()).toBe(90 * 60_000);
    expect(bar.blocks.find((b) => b.label === "Shift")!.popover.kindLabel).toBe("Work");
    expect(bar.blocks.find((b) => b.label === "Call")!.popover.kindLabel).toBe("Task");
  });

  it("the hour scale: an hourly tick with a label on every third local hour", () => {
    expect(bar.ticks[0]).toMatchObject({ pct: 0 }); // 06:00
    expect(bar.ticks.length).toBe(17); // 06:00 .. 22:00 inclusive
    const labelled = bar.ticks.filter((t) => t.label).map((t) => t.label);
    expect(labelled).toEqual(["6 AM", "9 AM", "12 PM", "3 PM", "6 PM", "9 PM"]);
  });

  it("generic calendar events (a Google reader can feed these later) become blocks with a popover; all-day ones are listed apart", () => {
    const withCal = buildDayBar({
      layout: null,
      wake: WAKE,
      end: END,
      now: NOW,
      efficiencyPercent: null,
      calendarEvents: [
        { id: "1", title: "Dentist", startAt: at("2026-10-05T15:00:00"), endAt: at("2026-10-05T16:00:00"), location: "Main St", description: "Bring forms", link: "https://example.com/e" },
        { id: "2", title: "Eid", startAt: at("2026-10-05T00:00:00"), endAt: null, allDay: true },
        { id: "3", title: "Yesterday", startAt: at("2026-10-04T10:00:00"), endAt: at("2026-10-04T11:00:00") },
      ],
    });
    const dentist = withCal.blocks.find((b) => b.kind === "calendar")!;
    expect(dentist.popover).toMatchObject({ kindLabel: "Calendar", title: "Dentist", location: "Main St", description: "Bring forms", link: "https://example.com/e" });
    expect(withCal.blocks.map((b) => b.label)).not.toContain("Yesterday"); // outside the bar
    expect(withCal.allDay.map((a) => a.title)).toEqual(["Eid"]);
    expect(withCal.blocks.map((b) => b.label)).not.toContain("Eid"); // positive control: all-day is not on the timeline
  });
});
