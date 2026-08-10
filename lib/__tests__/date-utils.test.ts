import { describe, expect, it } from "vitest";
import { getWeekStartDate } from "../date-utils";

describe("getWeekStartDate", () => {
  it("returns the same date when given a Sunday", () => {
    // 2026-08-09 is a Sunday.
    expect(getWeekStartDate("2026-08-09")).toBe("2026-08-09");
  });

  it("returns the prior Sunday for a mid-week date", () => {
    // 2026-08-13 is a Thursday; the prior Sunday is 2026-08-09.
    expect(getWeekStartDate("2026-08-13")).toBe("2026-08-09");
  });

  it("returns the prior Sunday for a Saturday", () => {
    // 2026-08-15 is a Saturday.
    expect(getWeekStartDate("2026-08-15")).toBe("2026-08-09");
  });
});
