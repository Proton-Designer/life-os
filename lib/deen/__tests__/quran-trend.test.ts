import { describe, expect, it } from "vitest";
import { bucketPagesByDay } from "../quran-trend";

describe("bucketPagesByDay", () => {
  it("sums pages read per day, in the given day order", () => {
    const pages = bucketPagesByDay(
      [
        { date: "2026-08-10", pages_read: 3 },
        { date: "2026-08-10", pages_read: 2 },
        { date: "2026-08-12", pages_read: 5 },
      ],
      ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12"]
    );
    expect(pages).toEqual([0, 5, 0, 5]);
  });

  it("returns all zeros for no sessions", () => {
    expect(bucketPagesByDay([], ["2026-08-09", "2026-08-10"])).toEqual([0, 0]);
  });
});
