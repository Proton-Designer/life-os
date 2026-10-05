import { describe, expect, it } from "vitest";
import {
  type QuranPlanParams,
  activeDaysThrough,
  applyReading,
  baseTargetDate,
  cumulativeTargetPages,
  daysBetween,
  effectiveTargetDate,
  expectedNextPage,
  isPlanSetupError,
  juzCompletedBetween,
  keepDateBaseline,
  khatmPercent,
  moveDateBaseline,
  pausedSpanDays,
  planDays,
  planPace,
  planSetupFor,
  planStatus,
  readingDaysInLast7,
  recentPace,
  todaysPortion,
} from "../plan";

const START = "2026-10-04";
const day = (n: number) => {
  const d = new Date(Date.UTC(2026, 9, 4 + n - 1));
  return d.toISOString().slice(0, 10); // day(1) = START
};

/** A 60-day plan from page 1 (target = start + 59 = 2026-12-02). */
function plan60(over: Partial<QuranPlanParams> = {}): QuranPlanParams {
  return {
    startDate: START, startPage: 1, planSetOn: START, planSetPage: 1, targetDate: day(60), pacePagesPerDay: null,
    originalPacePagesPerDay: 10.07, currentPage: 1, status: "active", pausedOn: null, pausedDays: 0, ...over,
  };
}
const noRecent = { pagesPerDay: 604 / 60, dataPoints: 0, usedPlanPace: true };
const status = (p: QuranPlanParams, d: string, recent = noRecent) => planStatus(p, d, recent);

describe("dates", () => {
  it("daysBetween is whole calendar days (no DST drift)", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-04", "2026-12-02")).toBe(59);
  });
});

describe("plan geometry (target-date plan)", () => {
  const p = plan60();
  it("60 days, ~10.07 pages/day, finishes on the target", () => {
    expect(planDays(p)).toBe(60);
    expect(planPace(p)).toBeCloseTo(10.067, 2);
    expect(baseTargetDate(p)).toBe("2026-12-02");
  });
  it("the cumulative target never goes down, grows by 10 or 11 a day, and LANDS EXACTLY on page 604 on the finish day", () => {
    let prev = 0;
    for (let n = 1; n <= 60; n++) {
      const c = cumulativeTargetPages(p, day(n));
      expect([10, 11]).toContain(c - prev);
      prev = c;
    }
    expect(cumulativeTargetPages(p, day(60))).toBe(604);
    expect(expectedNextPage(p, day(60))).toBe(605);
    expect(cumulativeTargetPages(p, day(59))).toBeLessThan(604);
    expect(cumulativeTargetPages(p, day(90))).toBe(604); // past the date it stays capped
  });
});

describe("todaysPortion", () => {
  it("day 1 from the bookmark at page 1: pages 1-10", () => {
    expect(todaysPortion(plan60(), day(1))).toEqual({ from: 1, to: 10, pages: 10, done: false });
  });
  it("day 2 after finishing day 1 (bookmark 11): pages 11-20", () => {
    expect(todaysPortion(plan60({ currentPage: 11 }), day(2))).toEqual({ from: 11, to: 20, pages: 10, done: false });
  });
  it("behind: the portion absorbs the catch-up (bookmark 11 on day 5 -> 11..50)", () => {
    const portion = todaysPortion(plan60({ currentPage: 11 }), day(5))!;
    expect(portion.from).toBe(11);
    expect(portion.to).toBe(expectedNextPage(plan60(), day(5)) - 1);
    expect(portion.to).toBe(50);
  });
  it("ahead: still at least one page while unfinished, and `done` says today's target is already met", () => {
    const portion = todaysPortion(plan60({ currentPage: 100 }), day(3))!;
    expect(portion).toMatchObject({ from: 100, to: 100, pages: 1, done: true });
  });
  it("exactly at today's target is done", () => {
    expect(todaysPortion(plan60({ currentPage: 11 }), day(1))!.done).toBe(true);
  });
  it("the last day ends on page 604; finished and paused plans have no portion", () => {
    expect(todaysPortion(plan60({ currentPage: 595 }), day(60))).toMatchObject({ from: 595, to: 604, pages: 10 });
    expect(todaysPortion(plan60({ currentPage: 605, status: "completed" }), day(61))).toBeNull();
    expect(todaysPortion(plan60({ status: "paused", pausedOn: day(3) }), day(4))).toBeNull();
  });
});

describe("status: on track / behind / ahead / completed", () => {
  it("pending today's portion with nothing behind = on track", () => {
    expect(status(plan60({ currentPage: 11 }), day(2))).toMatchObject({ kind: "on_track", pages: 0 });
  });
  it("today's portion done exactly = on track", () => {
    expect(status(plan60({ currentPage: 21 }), day(2))).toMatchObject({ kind: "on_track", pages: 0 });
  });
  it("behind: counts pages behind the end of yesterday and about how many days that is", () => {
    const s = status(plan60({ currentPage: 11 }), day(5));
    expect(s).toMatchObject({ kind: "behind", pages: 30, days: 3 });
  });
  it("ahead: pages beyond today's target", () => {
    expect(status(plan60({ currentPage: 100 }), day(3))).toMatchObject({ kind: "ahead", pages: 69 });
  });
  it("finished = completed", () => {
    expect(status(plan60({ currentPage: 605, status: "completed" }), day(61))).toMatchObject({ kind: "completed", pagesLeft: 0, projectedFinish: null });
  });
  it("needed per day = pages left / active days left including today", () => {
    const s = status(plan60({ currentPage: 11 }), day(2));
    expect(s.daysLeft).toBe(59);
    expect(s.neededPerDay).toBeCloseTo(594 / 59, 5);
  });
  it("past the target date it needs everything today (daysLeft 1)", () => {
    const s = status(plan60({ currentPage: 500 }), day(70));
    expect(s.daysLeft).toBe(1);
    expect(s.neededPerDay).toBe(105);
  });
});

describe("projected finish and the 2x 'move the date' nudge", () => {
  it("with too little data it projects at the PLAN pace (on track -> about the target)", () => {
    const s = status(plan60({ currentPage: 21 }), day(2));
    expect(s.recent.usedPlanPace).toBe(true);
    expect(s.projectedFinish! <= "2026-12-05").toBe(true);
    expect(s.suggestMoveDate).toBe(false);
  });
  it("at a slower recent pace it projects later than the target", () => {
    const slow = { pagesPerDay: 5, dataPoints: 8, usedPlanPace: false };
    const s = status(plan60({ currentPage: 100 }), day(20), slow);
    expect(s.projectedFinish).toBe("2026-10-23".replace("2026-10-23", s.projectedFinish!));
    expect(s.projectedFinish! > s.effectiveTargetDate).toBe(true);
  });
  it("needed pace > 2x the ORIGINAL pace suggests moving the date, to the projected finish", () => {
    const s = status(plan60({ currentPage: 1 }), day(45));
    expect(s.neededPerDay).toBeGreaterThan(2 * 10.07);
    expect(s.suggestMoveDate).toBe(true);
    expect(s.suggestedDate).toBe(s.projectedFinish);
  });
  it("positive control: the same plan, only modestly behind, does NOT trigger the nudge", () => {
    const s = status(plan60({ currentPage: 300 }), day(40));
    expect(s.neededPerDay).toBeLessThan(2 * 10.07);
    expect(s.suggestMoveDate).toBe(false);
  });
});

describe("pause", () => {
  const paused = plan60({ status: "paused", pausedOn: day(7), currentPage: 61 });
  it("freezes the expected page at the end of the day before the pause", () => {
    const frozen = expectedNextPage(paused, day(6));
    expect(expectedNextPage(paused, day(7))).toBe(frozen);
    expect(expectedNextPage(paused, day(30))).toBe(frozen);
    expect(activeDaysThrough(paused, day(30))).toBe(6);
  });
  it("the finish date moves out by the frozen days while paused", () => {
    expect(effectiveTargetDate(paused, day(7))).toBe(day(61)); // 1 frozen day so far
    expect(effectiveTargetDate(paused, day(11))).toBe(day(65)); // 5 frozen days
  });
  it("after resuming on day 11 the 4 frozen days (7..10) are excluded; the day resumed on is active", () => {
    const resumed = plan60({ pausedDays: pausedSpanDays(day(7), day(11)), currentPage: 61 });
    expect(resumed.pausedDays).toBe(4);
    expect(activeDaysThrough(resumed, day(11))).toBe(7); // days 1-6 and 11
    expect(effectiveTargetDate(resumed, day(11))).toBe(day(64));
    expect(todaysPortion(resumed, day(11))!.from).toBe(61);
  });
  it("status while paused is paused (no behind/ahead, no projection)", () => {
    expect(status(paused, day(9))).toMatchObject({ kind: "paused", projectedFinish: null, suggestMoveDate: false });
  });
  it("positive control: WITHOUT the pause the expected page would have kept advancing", () => {
    expect(expectedNextPage(plan60(), day(30))).toBeGreaterThan(expectedNextPage(paused, day(30)));
  });
});

describe("pace-based plans and mid-Quran starts", () => {
  it("20 pages/day from page 1: 31 days, target derived", () => {
    const p = plan60({ targetDate: null, pacePagesPerDay: 20, originalPacePagesPerDay: 20 });
    expect(planDays(p)).toBe(31);
    expect(baseTargetDate(p)).toBe(day(31));
    expect(expectedNextPage(p, day(31))).toBe(605);
    expect(expectedNextPage(p, day(1))).toBe(21);
  });
  it("starting on page 300 only counts the pages left (305)", () => {
    const p = plan60({ startPage: 300, planSetPage: 300, currentPage: 300 });
    expect(cumulativeTargetPages(p, day(60))).toBe(305);
    expect(expectedNextPage(p, day(60))).toBe(605);
  });
});

describe("recentPace / consistency", () => {
  const log = (date: string, pages: number) => ({ date, pages });
  it("fewer than 3 reading days falls back to the plan pace", () => {
    expect(recentPace([log(day(9), 20), log(day(10), 20)], day(10), START, 10)).toMatchObject({ pagesPerDay: 10, usedPlanPace: true, dataPoints: 2 });
  });
  it("3+ reading days: total pages / the window (14 days, or since the plan began)", () => {
    const sessions = [log(day(5), 14), log(day(8), 14), log(day(12), 14), log(day(14), 14)];
    expect(recentPace(sessions, day(14), START, 10)).toMatchObject({ pagesPerDay: 56 / 14, usedPlanPace: false, dataPoints: 4 });
    expect(recentPace([log(day(1), 10), log(day(2), 10), log(day(3), 10)], day(3), START, 5).pagesPerDay).toBe(10); // young plan: 3-day window
  });
  it("logs older than the window are ignored", () => {
    const sessions = [log(day(1), 500), log(day(20), 7), log(day(21), 7), log(day(22), 7)];
    expect(recentPace(sessions, day(22), START, 10).pagesPerDay).toBeCloseTo(21 / 14, 5);
  });
  it("'N of the last 7 days' counts distinct days, no streak logic", () => {
    const sessions = [log(day(10), 3), log(day(10), 2), log(day(8), 5), log(day(3), 5)];
    expect(readingDaysInLast7(sessions, day(10))).toBe(2);
  });
});

describe("logging + milestones", () => {
  it("moves the bookmark forward only, to toPage + 1, and counts pages", () => {
    expect(applyReading(11, 20)).toMatchObject({ newCurrentPage: 21, pagesRead: 10, fromPage: 11, toPage: 20, khatmComplete: false });
  });
  it("refuses a page behind the bookmark (use edit bookmark), out of range, and a finished khatm", () => {
    expect(applyReading(50, 40)).toMatchObject({ error: expect.stringMatching(/Edit bookmark/) });
    expect(applyReading(50, 0)).toMatchObject({ error: expect.any(String) });
    expect(applyReading(50, 605)).toMatchObject({ error: expect.any(String) });
    expect(applyReading(605, 604)).toMatchObject({ error: expect.stringMatching(/complete/) });
  });
  it("juz and khatm milestones", () => {
    expect(juzCompletedBetween(20, 23)).toEqual([1]); // juz 1 ends on page 21
    expect(juzCompletedBetween(20, 22)).toEqual([1]);
    expect(juzCompletedBetween(1, 22)).toEqual([1]);
    expect(juzCompletedBetween(22, 30)).toEqual([]);
    expect(juzCompletedBetween(1, 62)).toEqual([1, 2, 3]); // pages 1-61: juz 1 (-21), 2 (-41), 3 (-61)
    expect(juzCompletedBetween(1, 61)).toEqual([1, 2]);
    expect(juzCompletedBetween(21, 22)).toEqual([1]);
    const fin = applyReading(600, 604);
    expect(fin).toMatchObject({ newCurrentPage: 605, khatmComplete: true, juzCompleted: [30] });
    expect(khatmPercent(1)).toBe(0);
    expect(khatmPercent(303)).toBe(50);
    expect(khatmPercent(605)).toBe(100);
  });
});

describe("setup presets", () => {
  it("30 / 60 days and 6 months", () => {
    const a = planSetupFor({ kind: "days", days: 30 }, START, 1);
    expect(a).toMatchObject({ targetDate: day(30), pacePagesPerDay: null });
    expect((a as { originalPacePagesPerDay: number }).originalPacePagesPerDay).toBeCloseTo(20.13, 2);
    const b = planSetupFor({ kind: "days", days: 60 }, START, 1);
    expect((b as { originalPacePagesPerDay: number }).originalPacePagesPerDay).toBeCloseTo(10.07, 2);
    const c = planSetupFor({ kind: "six_months" }, START, 1);
    expect((c as { targetDate: string }).targetDate).toBe("2027-04-03"); // start + 181 = 182 days inclusive (26 weeks), matching the card's preview
    expect(daysBetween(START, "2027-04-03") + 1).toBe(182);
    expect((c as { originalPacePagesPerDay: number }).originalPacePagesPerDay).toBeLessThan(4);
  });
  it("Ramadan uses the end date when known (and not in the past), else 30 days", () => {
    expect(planSetupFor({ kind: "ramadan", ramadanEnd: "2027-03-09" }, "2027-02-08", 1)).toMatchObject({ targetDate: "2027-03-09" });
    expect(planSetupFor({ kind: "ramadan" }, START, 1)).toMatchObject({ targetDate: day(30) });
    expect(planSetupFor({ kind: "ramadan", ramadanEnd: "2026-01-01" }, START, 1)).toMatchObject({ targetDate: day(30) });
  });
  it("custom date and custom pace, with validation", () => {
    expect(planSetupFor({ kind: "custom_date", targetDate: "2026-12-31" }, START, 1)).toMatchObject({ targetDate: "2026-12-31" });
    expect(isPlanSetupError(planSetupFor({ kind: "custom_date", targetDate: "2026-10-01" }, START, 1))).toBe(true);
    expect(planSetupFor({ kind: "custom_pace", pagesPerDay: 20 }, START, 1)).toMatchObject({ targetDate: null, pacePagesPerDay: 20, originalPacePagesPerDay: 20 });
    expect(isPlanSetupError(planSetupFor({ kind: "custom_pace", pagesPerDay: 0.1 }, START, 1))).toBe(true);
    expect(isPlanSetupError(planSetupFor({ kind: "custom_pace", pagesPerDay: 700 }, START, 1))).toBe(true);
    expect(isPlanSetupError(planSetupFor({ kind: "days", days: 30 }, START, 0))).toBe(true);
  });
  it("starting from the current page re-computes the pace on the pages left", () => {
    const s = planSetupFor({ kind: "days", days: 30 }, START, 301) as { originalPacePagesPerDay: number };
    expect(s.originalPacePagesPerDay).toBeCloseTo(304 / 30, 2);
  });
});

describe("keep / move the date", () => {
  it("keep: the same effective finish day, re-spread from today at the bookmark, pause history cleared", () => {
    const p = plan60({ currentPage: 100, pausedDays: 3 });
    const b = keepDateBaseline(p, day(20));
    expect(b).toEqual({ planSetOn: day(20), planSetPage: 100, targetDate: effectiveTargetDate(p, day(20)), pacePagesPerDay: null, pausedDays: 0 });
    // the new baseline needs (605-100)/(days to the target) per day from today
    const rebased = plan60({ currentPage: 100, ...(b as object), planSetOn: day(20), planSetPage: 100 });
    expect(planPace(rebased)).toBeCloseTo(505 / (daysBetween(day(20), (b as { targetDate: string }).targetDate) + 1), 5);
  });
  it("keep after the date has passed asks to move instead; move validates the new date", () => {
    expect(keepDateBaseline(plan60({ currentPage: 100 }), day(80))).toMatchObject({ error: expect.any(String) });
    expect(moveDateBaseline(plan60(), day(20), day(10))).toMatchObject({ error: expect.any(String) });
    expect(moveDateBaseline(plan60({ currentPage: 100 }), day(20), day(100))).toMatchObject({ planSetOn: day(20), planSetPage: 100, targetDate: day(100), pausedDays: 0 });
  });
});
