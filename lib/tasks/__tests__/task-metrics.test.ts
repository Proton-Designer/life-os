import { describe, expect, it } from "vitest";
import { countOverdue, countCompletedInWeek } from "../task-metrics";

describe("countOverdue", () => {
  it("counts open tasks whose due date is strictly before today", () => {
    const count = countOverdue(
      [
        { dueDate: "2026-08-14", completed: false },
        { dueDate: "2026-08-15", completed: false },
        { dueDate: "2026-08-16", completed: false },
      ],
      "2026-08-15"
    );
    expect(count).toBe(1);
  });

  it("excludes tasks with no due date", () => {
    expect(countOverdue([{ dueDate: null, completed: false }], "2026-08-15")).toBe(0);
  });
});

describe("countCompletedInWeek", () => {
  it("counts tasks completed within the given week window", () => {
    const count = countCompletedInWeek(
      [
        { completedAt: "2026-08-11T10:00:00Z" }, // in window
        { completedAt: "2026-08-09T10:00:00Z" }, // before window
        { completedAt: null }, // never completed
      ],
      "2026-08-10",
      "2026-08-17"
    );
    expect(count).toBe(1);
  });

  it("returns 0 when nothing was completed in the window", () => {
    expect(countCompletedInWeek([{ completedAt: null }], "2026-08-10", "2026-08-17")).toBe(0);
  });
});
