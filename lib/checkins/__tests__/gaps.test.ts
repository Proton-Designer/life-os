import { describe, expect, it } from "vitest";
import { allocationForChoice, computeUntrackedGaps, creditedMinutes, splitGap, validateGapAnswers, type Gap } from "../gaps";

const at = (hhmm: string) => new Date(`2026-10-11T${hhmm}:00.000Z`);
const bounds = { wakeTime: "08:00", sleepTime: "22:00" };
const base = { dateStr: "2026-10-11", bounds, timezone: "UTC", now: at("21:00") };

describe("computeUntrackedGaps", () => {
  it("an empty day is one gap from wake to now (never past now)", () => {
    const gaps = computeUntrackedGaps({ ...base, covered: [] });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].start).toEqual(at("08:00"));
    expect(gaps[0].end).toEqual(at("21:00"));
    expect(gaps[0].minutes).toBe(13 * 60);
  });

  it("subtracts sessions, prayers and answered windows, leaving the stretches between", () => {
    const gaps = computeUntrackedGaps({
      ...base,
      covered: [
        { start: at("09:00"), end: at("10:30") }, // a session
        { start: at("13:00"), end: at("13:15") }, // a prayer
        { start: at("15:00"), end: at("17:00") }, // an answered check-in window
      ],
    });
    expect(gaps.map((g) => [g.start.toISOString().slice(11, 16), g.end.toISOString().slice(11, 16)])).toEqual([
      ["08:00", "09:00"],
      ["10:30", "13:00"],
      ["13:15", "15:00"],
      ["17:00", "21:00"],
    ]);
  });

  it("drops stretches under 30 minutes and merges overlapping covered ranges", () => {
    const gaps = computeUntrackedGaps({
      ...base,
      covered: [
        { start: at("08:00"), end: at("10:00") },
        { start: at("09:30"), end: at("10:20") }, // overlaps the first
        { start: at("10:40"), end: at("21:00") }, // leaves 10:20-10:40 = 20 min, too short
      ],
    });
    expect(gaps).toEqual([]);
  });

  it("an open session (no end) covers up to now", () => {
    const gaps = computeUntrackedGaps({ ...base, covered: [{ start: at("14:00"), end: null }] });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].end).toEqual(at("14:00"));
  });

  it("nothing before the wake time or after the sleep time, and nothing when now is before wake", () => {
    expect(computeUntrackedGaps({ ...base, now: at("23:30"), covered: [] })[0].end).toEqual(at("22:00"));
    expect(computeUntrackedGaps({ ...base, now: at("07:00"), covered: [] })).toEqual([]);
  });

  it("an inverted wake/sleep range yields nothing rather than a bad gap", () => {
    expect(computeUntrackedGaps({ ...base, bounds: { wakeTime: "22:00", sleepTime: "06:00" }, covered: [] })).toEqual([]);
  });
});

describe("answers", () => {
  it("credits whole 15-minute steps and maps each choice to an allocation", () => {
    expect(creditedMinutes(100)).toBe(90);
    expect(creditedMinutes(14)).toBe(0);
    expect(allocationForChoice("business", 100)).toEqual({ allocation: { business: 90 }, wastedMinutes: 0 });
    expect(allocationForChoice("wasted", 100)).toEqual({ allocation: {}, wastedMinutes: 90 });
    expect(allocationForChoice("rest", 100)).toEqual({ allocation: {}, wastedMinutes: 0 });
    expect(allocationForChoice("errands", 100)).toEqual({ allocation: {}, wastedMinutes: 0 });
  });

  const gaps: Gap[] = [{ start: at("10:30"), end: at("13:00"), minutes: 150 }];
  const ans = (s: string, e: string, choice: string) => ({ start: at(s).toISOString(), end: at(e).toISOString(), choice }) as never;

  it("accepts answers inside a stretch and sorts them", () => {
    const r = validateGapAnswers(gaps, [ans("12:00", "13:00", "rest"), ans("10:30", "12:00", "school")], { allowFaith: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.answers.map((a) => a.choice)).toEqual(["school", "rest"]);
  });

  it("refuses an answer outside any stretch (e.g. time a session already covers), overlapping answers, tiny spans, bad choices, and Faith when off", () => {
    expect(validateGapAnswers(gaps, [ans("09:00", "11:00", "rest")], { allowFaith: true }).ok).toBe(false);
    expect(validateGapAnswers(gaps, [ans("10:30", "12:00", "rest"), ans("11:30", "13:00", "rest")], { allowFaith: true }).ok).toBe(false);
    expect(validateGapAnswers(gaps, [ans("10:30", "10:40", "rest")], { allowFaith: true }).ok).toBe(false);
    expect(validateGapAnswers(gaps, [ans("10:30", "12:00", "napping")], { allowFaith: true }).ok).toBe(false);
    expect(validateGapAnswers(gaps, [ans("10:30", "12:00", "deen")], { allowFaith: false }).ok).toBe(false);
  });
});

describe("splitGap", () => {
  const gap: Gap = { start: at("10:30"), end: at("13:00"), minutes: 150 };
  it("splits at a 15-minute boundary into two parts that tile the stretch", () => {
    const parts = splitGap(gap, 60)!;
    expect(parts[0]).toMatchObject({ start: at("10:30"), end: at("11:30"), minutes: 60 });
    expect(parts[1]).toMatchObject({ start: at("11:30"), end: at("13:00"), minutes: 90 });
  });
  it("refuses a split that leaves a part under 15 minutes or off the step", () => {
    expect(splitGap(gap, 0)).toBeNull();
    expect(splitGap(gap, 150)).toBeNull();
    expect(splitGap(gap, 140)).toBeNull();
    expect(splitGap(gap, 20)).toBeNull();
  });
});
