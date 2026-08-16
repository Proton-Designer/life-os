import { describe, expect, it } from "vitest";
import { countDaysCleared } from "../kill-list-cleared";

describe("countDaysCleared", () => {
  it("counts a day as cleared only when every item that day is completed", () => {
    const count = countDaysCleared([
      { date: "2026-08-14", completed: true },
      { date: "2026-08-14", completed: true },
      { date: "2026-08-15", completed: true },
      { date: "2026-08-15", completed: false },
    ]);
    expect(count).toBe(1); // only 08-14 is fully cleared
  });

  it("does not count a day with zero items as cleared", () => {
    expect(countDaysCleared([])).toBe(0);
  });

  it("counts every fully-cleared day, not just the most recent", () => {
    const count = countDaysCleared([
      { date: "2026-08-13", completed: true },
      { date: "2026-08-14", completed: true },
    ]);
    expect(count).toBe(2);
  });
});
