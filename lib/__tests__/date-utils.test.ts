import { describe, expect, it } from "vitest";
import { getWeekStartDate, formatTopbarDate } from "../date-utils";

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

describe("formatTopbarDate", () => {
  it("formats as short weekday, short month, day", () => {
    // 2026-08-15T12:00:00Z is a Saturday.
    expect(formatTopbarDate(new Date("2026-08-15T12:00:00Z"), "UTC")).toBe("Sat, Aug 15");
  });

  it("respects the given timezone across a day boundary", () => {
    // 2026-08-15T02:00:00Z is still 2026-08-14 21:00 in America/Chicago (UTC-5 in August).
    expect(formatTopbarDate(new Date("2026-08-15T02:00:00Z"), "America/Chicago")).toBe("Fri, Aug 14");
  });
});
