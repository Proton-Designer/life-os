import { describe, expect, it } from "vitest";
import {
  getWeekStartDate,
  formatTopbarDate,
  formatDurationMagnitude,
  formatRelativeDuration,
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
