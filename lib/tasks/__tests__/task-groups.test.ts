import { describe, expect, it } from "vitest";
import { bucketTaskGroup, groupTasksByBucket } from "../task-groups";

const TODAY = "2026-08-25"; // Tuesday
const WEEK_DATES = ["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29"];

describe("bucketTaskGroup", () => {
  it("buckets today's date as today", () => {
    expect(bucketTaskGroup("2026-08-25", TODAY, WEEK_DATES)).toBe("today");
  });

  it("buckets another day in this week's Sun-Sat range as week", () => {
    expect(bucketTaskGroup("2026-08-27", TODAY, WEEK_DATES)).toBe("week");
  });

  it("buckets a day earlier this week (already overdue) as week, not a separate overdue bucket", () => {
    expect(bucketTaskGroup("2026-08-24", TODAY, WEEK_DATES)).toBe("week");
  });

  it("buckets a later day in the same calendar month, outside this week, as month", () => {
    expect(bucketTaskGroup("2026-08-31", TODAY, WEEK_DATES)).toBe("month");
  });

  it("buckets an earlier day in the same calendar month, outside this week, as month", () => {
    expect(bucketTaskGroup("2026-08-02", TODAY, WEEK_DATES)).toBe("month");
  });

  it("buckets a day in a later month as future", () => {
    expect(bucketTaskGroup("2026-09-03", TODAY, WEEK_DATES)).toBe("future");
  });

  it("buckets a day in an earlier month as future", () => {
    expect(bucketTaskGroup("2026-07-15", TODAY, WEEK_DATES)).toBe("future");
  });

  it("buckets a null due date as future", () => {
    expect(bucketTaskGroup(null, TODAY, WEEK_DATES)).toBe("future");
  });
});

/**
 * D-036-adjacent: a hardcoded date in e2e/school-class-view.spec.ts broke
 * silently at the 2026-09 rollover (passed for six days, failed at
 * midnight on the 1st) and looked like a Phase 2 regression for hours. The
 * e2e side was fixed by deriving the date instead of hardcoding it; this
 * pins the bucketing RULE ITSELF across a month boundary and a year
 * boundary, so a real regression here is caught in <1s locally instead of
 * live at the next rollover. Every case below is a boundary the existing
 * suite's single fixed `TODAY` (a mid-month Tuesday) never exercises: the
 * `weekDates.includes` check runs before the month-prefix check, so a week
 * spanning a month or year boundary is the case most likely to break if
 * that ordering were ever "simplified."
 */
describe("bucketTaskGroup — month and year boundaries", () => {
  it("buckets a date that's in THIS WEEK but NEXT month as week, not month or future — the week check must win", () => {
    const today = "2026-08-31"; // Monday
    const weekDates = ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
    expect(bucketTaskGroup("2026-09-02", today, weekDates)).toBe("week");
  });

  it("buckets a date earlier in the SAME month as today, outside this week, as month — even when today is the last day of the month", () => {
    const today = "2026-08-31";
    const weekDates = ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
    expect(bucketTaskGroup("2026-08-15", today, weekDates)).toBe("month");
  });

  it("buckets a date from the PREVIOUS month as future once today has rolled into a new month, not month (the exact regression shape: a task due late last month must not still read as 'this month')", () => {
    const today = "2026-09-01";
    const weekDates = ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
    expect(bucketTaskGroup("2026-08-28", today, weekDates)).toBe("future");
  });

  it("crosses a YEAR boundary within the same week correctly — a January date lands in week, not future, when today is the last days of December", () => {
    const today = "2025-12-31"; // Wednesday
    const weekDates = ["2025-12-28", "2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03"];
    expect(bucketTaskGroup("2026-01-02", today, weekDates)).toBe("week");
  });

  it("buckets a date from the PREVIOUS year as future once today has rolled into January, not month — proves the YYYY-MM string-prefix compare needs no special year-rollover arithmetic to get this right", () => {
    const today = "2026-01-01";
    const weekDates = ["2025-12-28", "2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03"];
    expect(bucketTaskGroup("2025-12-20", today, weekDates)).toBe("future");
  });

  it("still buckets today itself as today when today is a month/year boundary date", () => {
    expect(bucketTaskGroup("2026-01-01", "2026-01-01", ["2025-12-28", "2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03"])).toBe(
      "today"
    );
  });
});

describe("groupTasksByBucket", () => {
  it("sorts each bucket soonest-first", () => {
    const tasks = [
      { id: "a", dueDate: "2026-08-29" },
      { id: "b", dueDate: "2026-08-26" },
      { id: "c", dueDate: "2026-08-27" },
    ];
    const groups = groupTasksByBucket(tasks, TODAY, WEEK_DATES);
    expect(groups.week.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts a null due date last within its bucket", () => {
    const tasks = [
      { id: "dated", dueDate: "2026-09-10" },
      { id: "undated", dueDate: null },
    ];
    const groups = groupTasksByBucket(tasks, TODAY, WEEK_DATES);
    expect(groups.future.map((t) => t.id)).toEqual(["dated", "undated"]);
  });

  it("places every task in exactly one bucket", () => {
    const tasks = [
      { id: "today", dueDate: "2026-08-25" },
      { id: "week", dueDate: "2026-08-27" },
      { id: "month", dueDate: "2026-08-31" },
      { id: "future", dueDate: "2026-09-05" },
    ];
    const groups = groupTasksByBucket(tasks, TODAY, WEEK_DATES);
    expect(groups.today.map((t) => t.id)).toEqual(["today"]);
    expect(groups.week.map((t) => t.id)).toEqual(["week"]);
    expect(groups.month.map((t) => t.id)).toEqual(["month"]);
    expect(groups.future.map((t) => t.id)).toEqual(["future"]);
  });
});
