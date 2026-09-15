import { describe, expect, it } from "vitest";
import { computeCourseLoadForecast, type ForecastableAssessment } from "../course-load-forecast";

const TODAY = "2026-09-15"; // a Tuesday

function assessment(overrides: Partial<ForecastableAssessment> = {}): ForecastableAssessment {
  return {
    id: "a1",
    name: "Midterm",
    className: "CS 101",
    date: "2026-09-20",
    weightPct: null,
    pointsEarned: null,
    isExcused: false,
    ...overrides,
  };
}

describe("computeCourseLoadForecast", () => {
  it("returns a full 6-week grid even with zero data -- the empty weeks ARE the forecast", () => {
    const result = computeCourseLoadForecast([], TODAY);
    expect(result.weeks).toHaveLength(6);
    expect(result.weeks.every((w) => w.itemCount === 0)).toBe(true);
    expect(result.hasAnyUpcomingWork).toBe(false);
  });

  it("excludes excused assessments entirely -- never counted toward load", () => {
    const result = computeCourseLoadForecast([assessment({ isExcused: true })], TODAY);
    expect(result.hasAnyUpcomingWork).toBe(false);
  });

  it("excludes already-graded assessments (pointsEarned set) -- not upcoming work", () => {
    const result = computeCourseLoadForecast([assessment({ pointsEarned: 90 })], TODAY);
    expect(result.hasAnyUpcomingWork).toBe(false);
  });

  it("excludes assessments dated before today", () => {
    const result = computeCourseLoadForecast([assessment({ date: "2026-09-01" })], TODAY);
    expect(result.hasAnyUpcomingWork).toBe(false);
  });

  it("buckets a real upcoming assessment into its own week", () => {
    const result = computeCourseLoadForecast([assessment({ date: "2026-09-20" })], TODAY);
    expect(result.hasAnyUpcomingWork).toBe(true);
    const week = result.weeks.find((w) => w.itemCount > 0)!;
    expect(week.items[0]!.id).toBe("a1");
  });

  it("null weightPct is never treated as zero -- excluded from totalWeightPct's sum, and the week's total is null when nothing has a weight", () => {
    const result = computeCourseLoadForecast([assessment({ weightPct: null })], TODAY);
    const week = result.weeks.find((w) => w.itemCount > 0)!;
    expect(week.totalWeightPct).toBeNull();
  });

  it("sums only the non-null weights in a week", () => {
    const result = computeCourseLoadForecast(
      [
        assessment({ id: "a1", date: "2026-09-20", weightPct: 10 }),
        assessment({ id: "a2", date: "2026-09-21", weightPct: null }),
        assessment({ id: "a3", date: "2026-09-22", weightPct: 15 }),
      ],
      TODAY,
    );
    const week = result.weeks.find((w) => w.itemCount > 0)!;
    expect(week.totalWeightPct).toBe(25);
    expect(week.itemCount).toBe(3);
  });

  it("overflow triggers on item count alone (3+), even with no weight data at all", () => {
    const result = computeCourseLoadForecast(
      [
        assessment({ id: "a1", date: "2026-09-20" }),
        assessment({ id: "a2", date: "2026-09-21" }),
        assessment({ id: "a3", date: "2026-09-22" }),
      ],
      TODAY,
    );
    const week = result.weeks.find((w) => w.itemCount > 0)!;
    expect(week.overflow).toBe(true);
  });

  it("2 items is NOT overflow by count alone (threshold is 3+)", () => {
    const result = computeCourseLoadForecast(
      [assessment({ id: "a1", date: "2026-09-20" }), assessment({ id: "a2", date: "2026-09-21" })],
      TODAY,
    );
    const week = result.weeks.find((w) => w.itemCount > 0)!;
    expect(week.overflow).toBe(false);
  });

  it("overflow ALSO triggers on 2+ heavy items (>=20% weight) in the same week, even with a low raw count", () => {
    const result = computeCourseLoadForecast(
      [
        assessment({ id: "a1", date: "2026-09-20", weightPct: 30, className: "CS 101" }),
        assessment({ id: "a2", date: "2026-09-21", weightPct: 25, className: "MATH 201" }),
      ],
      TODAY,
    );
    const week = result.weeks.find((w) => w.itemCount > 0)!;
    expect(week.heavyItemCount).toBe(2);
    expect(week.overflow).toBe(true);
  });

  it("1 heavy item plus 1 light item is NOT overflow (only 2 items, only 1 heavy)", () => {
    const result = computeCourseLoadForecast(
      [
        assessment({ id: "a1", date: "2026-09-20", weightPct: 30 }),
        assessment({ id: "a2", date: "2026-09-21", weightPct: 5 }),
      ],
      TODAY,
    );
    const week = result.weeks.find((w) => w.itemCount > 0)!;
    expect(week.overflow).toBe(false);
  });

  it("THE REGRESSION GUARD: does NOT sum weight_pct across classes into a fabricated overflow threshold -- two 15%-weighted items from different classes (30 combined) is not overflow by weight alone", () => {
    const result = computeCourseLoadForecast(
      [
        assessment({ id: "a1", date: "2026-09-20", weightPct: 15, className: "CS 101" }),
        assessment({ id: "a2", date: "2026-09-21", weightPct: 15, className: "MATH 201" }),
      ],
      TODAY,
    );
    const week = result.weeks.find((w) => w.itemCount > 0)!;
    expect(week.totalWeightPct).toBe(30);
    expect(week.overflow).toBe(false); // neither item is individually "heavy" (>=20%), and count is only 2
  });

  it("an assessment on the last day of the 6-week horizon is included; the day after is not", () => {
    // horizonStart = getWeekStartDate(TODAY) = 2026-09-13 (Sunday). The grid
    // covers [2026-09-13, 2026-10-25) -- 6 full weeks -- so 2026-10-24 is the
    // last included date and 2026-10-25 is the first excluded one.
    const result = computeCourseLoadForecast(
      [assessment({ id: "in", date: "2026-10-24" }), assessment({ id: "out", date: "2026-10-25" })],
      TODAY,
    );
    const allIds = result.weeks.flatMap((w) => w.items.map((it) => it.id));
    expect(allIds).toContain("in");
    expect(allIds).not.toContain("out");
  });

  it("items within a week are sorted by date ascending", () => {
    const result = computeCourseLoadForecast(
      [
        assessment({ id: "later", date: "2026-09-22" }),
        assessment({ id: "earlier", date: "2026-09-20" }),
      ],
      TODAY,
    );
    const week = result.weeks.find((w) => w.itemCount > 0)!;
    expect(week.items.map((it) => it.id)).toEqual(["earlier", "later"]);
  });
});
