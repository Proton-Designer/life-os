import { describe, expect, it } from "vitest";
import {
  formatShortDate,
  getWeekStartDate,
  formatTopbarDate,
  formatDurationMagnitude,
  formatRelativeDuration,
  formatWindowRelativeTime,
  datesInMonth,
  addMonthsToDateString,
} from "../date-utils";

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

describe("formatDurationMagnitude", () => {
  it("formats under an hour as minutes", () => {
    expect(formatDurationMagnitude(41)).toBe("41m");
    expect(formatDurationMagnitude(59)).toBe("59m");
  });

  it("formats an hour or more (but under a day) as rounded hours", () => {
    expect(formatDurationMagnitude(60)).toBe("1h");
    expect(formatDurationMagnitude(90)).toBe("2h"); // rounds up
    expect(formatDurationMagnitude(778)).toBe("13h"); // the exact case that motivated this helper
  });

  it("rolls an hour rounding up to 24 over into 1 day, not '24h'", () => {
    // 1439 min = 23h59m, which naively rounds to 24h — must become 1d instead.
    expect(formatDurationMagnitude(1439)).toBe("1d");
  });

  it("formats a day or more as rounded days", () => {
    expect(formatDurationMagnitude(1440)).toBe("1d");
    expect(formatDurationMagnitude(2880)).toBe("2d");
    expect(formatDurationMagnitude(4200)).toBe("3d"); // 2.9d rounds up
  });

  it("takes the absolute value — sign is the caller's concern", () => {
    expect(formatDurationMagnitude(-778)).toBe("13h");
  });

  it("floors at 0m", () => {
    expect(formatDurationMagnitude(0)).toBe("0m");
  });
});

describe("formatRelativeDuration", () => {
  it("returns 'now' within a 1-minute margin either direction", () => {
    expect(formatRelativeDuration(0)).toBe("now");
    expect(formatRelativeDuration(1)).toBe("now");
    expect(formatRelativeDuration(-1)).toBe("now");
  });

  it("frames a negative diff as overdue", () => {
    expect(formatRelativeDuration(-41)).toBe("41m overdue");
    expect(formatRelativeDuration(-778)).toBe("13h overdue"); // the reported "778 min overdue" bug
    expect(formatRelativeDuration(-2880)).toBe("2d overdue");
  });

  it("frames a positive diff as upcoming", () => {
    expect(formatRelativeDuration(45)).toBe("in 45m");
    expect(formatRelativeDuration(150)).toBe("in 3h");
  });

  it("rounds a fractional diff before framing", () => {
    expect(formatRelativeDuration(-40.6)).toBe("41m overdue");
  });
});

describe("formatWindowRelativeTime", () => {
  const NOW = new Date("2026-08-20T20:00:00.000Z");

  it("shows time left, not overdue, once the window has opened but not closed — the reported bug", () => {
    // Window opened 2h ago (18:00), closes in 2h (22:00) — this used to
    // read "2h overdue," which is backwards: there's 2h left to pray it.
    const dueAt = new Date("2026-08-20T18:00:00.000Z");
    const windowEndAt = new Date("2026-08-20T22:00:00.000Z");
    expect(formatWindowRelativeTime(dueAt, windowEndAt, NOW)).toBe("2h left");
  });

  it("still shows 'in Xh' before the window has opened", () => {
    const dueAt = new Date("2026-08-20T22:00:00.000Z");
    const windowEndAt = new Date("2026-08-21T00:00:00.000Z");
    expect(formatWindowRelativeTime(dueAt, windowEndAt, NOW)).toBe("in 2h");
  });

  it("falls back to overdue framing once the window itself has closed", () => {
    const dueAt = new Date("2026-08-20T16:00:00.000Z");
    const windowEndAt = new Date("2026-08-20T18:00:00.000Z");
    expect(formatWindowRelativeTime(dueAt, windowEndAt, NOW)).toBe("4h overdue");
  });

  it("falls back to plain overdue/in-X framing when there's no window (e.g. a task deadline)", () => {
    const dueAt = new Date("2026-08-20T18:00:00.000Z");
    expect(formatWindowRelativeTime(dueAt, null, NOW)).toBe("2h overdue");
  });

  it("returns 'Today' when there's no dueAt at all", () => {
    expect(formatWindowRelativeTime(null, null, NOW)).toBe("Today");
  });
});

describe("datesInMonth", () => {
  it("returns all 31 days for a 31-day month", () => {
    const dates = datesInMonth(2026, 8);
    expect(dates).toHaveLength(31);
    expect(dates[0]).toBe("2026-08-01");
    expect(dates[30]).toBe("2026-08-31");
  });

  it("returns 28 days for February in a non-leap year", () => {
    expect(datesInMonth(2026, 2)).toHaveLength(28);
  });

  it("returns 29 days for February in a leap year", () => {
    expect(datesInMonth(2024, 2)).toHaveLength(29);
  });

  it("returns 30 days for a 30-day month", () => {
    expect(datesInMonth(2026, 4)).toHaveLength(30);
  });
});

describe("addMonthsToDateString", () => {
  it("shifts forward across a year boundary", () => {
    expect(addMonthsToDateString("2026-12-15", 1)).toBe("2027-01-15");
  });

  it("shifts backward across a year boundary", () => {
    expect(addMonthsToDateString("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("shifts backward by several months within the same year", () => {
    expect(addMonthsToDateString("2026-08-01", -3)).toBe("2026-05-01");
  });

  it("clamps the day into the target month rather than overflowing (Jan 31 - 1mo -> Feb 28)", () => {
    expect(addMonthsToDateString("2026-01-31", -1)).toBe("2025-12-31");
    expect(addMonthsToDateString("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("clamps into a leap-year February correctly", () => {
    expect(addMonthsToDateString("2024-03-31", -1)).toBe("2024-02-29");
  });
});

describe("formatShortDate", () => {
  it("formats a date as month abbreviation plus ordinal day", () => {
    expect(formatShortDate("2026-09-03", "2026-08-26")).toBe("Sep. 3rd");
    expect(formatShortDate("2026-10-06", "2026-08-26")).toBe("Oct. 6th");
    expect(formatShortDate("2026-12-01", "2026-08-26")).toBe("Dec. 1st");
    expect(formatShortDate("2026-11-22", "2026-08-26")).toBe("Nov. 22nd");
  });

  it("uses the right ordinal for the 11-13 exceptions and the 21st/31st", () => {
    expect(formatShortDate("2026-09-11", "2026-08-26")).toBe("Sep. 11th");
    expect(formatShortDate("2026-09-12", "2026-08-26")).toBe("Sep. 12th");
    expect(formatShortDate("2026-09-13", "2026-08-26")).toBe("Sep. 13th");
    expect(formatShortDate("2026-09-21", "2026-08-26")).toBe("Sep. 21st");
    expect(formatShortDate("2026-12-31", "2026-08-26")).toBe("Dec. 31st");
  });

  it("shows the year only when it differs from the reference date's year", () => {
    expect(formatShortDate("2027-01-05", "2026-08-26")).toBe("Jan. 5th, 2027");
    expect(formatShortDate("2026-01-05", "2026-08-26")).toBe("Jan. 5th");
  });

  it("does NOT shift the day backward in a timezone behind UTC", () => {
    // `new Date("2026-09-01")` is UTC midnight, which is Aug 31 in
    // America/Chicago. Splitting the string cannot exhibit that bug; this
    // test is the regression guard that keeps it that way.
    expect(formatShortDate("2026-09-01", "2026-08-26")).toBe("Sep. 1st");
    expect(formatShortDate("2026-01-01", "2026-01-01")).toBe("Jan. 1st");
    expect(formatShortDate("2026-03-01", "2026-03-01")).toBe("Mar. 1st");
  });

  it("returns the input unchanged when it is not a YYYY-MM-DD date", () => {
    expect(formatShortDate("")).toBe("");
    expect(formatShortDate("not a date")).toBe("not a date");
    expect(formatShortDate("2026-13-01", "2026-08-26")).toBe("2026-13-01");
  });
});
