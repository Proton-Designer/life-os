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
