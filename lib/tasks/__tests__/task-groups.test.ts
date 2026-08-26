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
