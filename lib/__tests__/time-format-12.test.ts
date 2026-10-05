import { describe, expect, it } from "vitest";
import { formatClock12, formatHHMM12, formatHHMMRange12, formatHourMinute12, parseHHMM, split12Hour, to24HourString } from "../date-utils";

describe("formatHHMM12", () => {
  it("converts every hour of the day correctly, including the 12 AM / 12 PM edges", () => {
    const cases: [string, string][] = [
      ["00:00", "12:00 AM"], ["00:05", "12:05 AM"], ["01:00", "1:00 AM"], ["09:30", "9:30 AM"], ["11:59", "11:59 AM"],
      ["12:00", "12:00 PM"], ["12:45", "12:45 PM"], ["13:00", "1:00 PM"], ["18:45", "6:45 PM"], ["21:00", "9:00 PM"], ["23:59", "11:59 PM"],
    ];
    for (const [input, out] of cases) expect(formatHHMM12(input), input).toBe(out);
  });
  it("accepts a Postgres time with seconds, and a single-digit hour", () => {
    expect(formatHHMM12("21:00:00")).toBe("9:00 PM");
    expect(formatHHMM12("7:05")).toBe("7:05 AM");
  });
  it("returns malformed input unchanged (never 'NaN', never a crash) and null/undefined as empty", () => {
    for (const bad of ["", "25:00", "12:60", "noon", "9pm", "21-00"]) expect(formatHHMM12(bad), bad).toBe(bad);
    expect(formatHHMM12(null)).toBe("");
    expect(formatHHMM12(undefined)).toBe("");
  });
  it("never emits a 24-hour hour above 12 for any valid minute of the day", () => {
    for (let m = 0; m < 1440; m++) {
      const out = formatHourMinute12(Math.floor(m / 60), m % 60);
      expect(out).toMatch(/^(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/);
    }
  });
});

describe("formatHHMMRange12", () => {
  it("joins two times, or shows whichever exists", () => {
    expect(formatHHMMRange12("08:30", "10:00")).toBe("8:30 AM – 10:00 AM");
    expect(formatHHMMRange12("08:30", null)).toBe("8:30 AM");
    expect(formatHHMMRange12(null, "17:00")).toBe("5:00 PM");
    expect(formatHHMMRange12(null, null)).toBe("");
  });
});

describe("formatClock12 (instants)", () => {
  it("is 12-hour in the requested zone regardless of locale", () => {
    expect(formatClock12(new Date("2026-10-06T02:05:00Z"), "America/Chicago").replace(/\s/g, " ")).toBe("9:05 PM");
    expect(formatClock12(new Date("2026-10-06T02:05:00Z"), "Asia/Karachi").replace(/\s/g, " ")).toBe("7:05 AM");
    expect(formatClock12(new Date("2026-10-06T05:00:00Z"), "UTC").replace(/\s/g, " ")).toBe("5:00 AM");
    expect(formatClock12(new Date("2026-10-06T00:00:00Z"), "UTC").replace(/\s/g, " ")).toBe("12:00 AM");
  });
});

describe("12-hour <-> 24-hour conversion (what TimeField12 stores)", () => {
  it("round-trips every minute of the day", () => {
    for (let m = 0; m < 1440; m++) {
      const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const p = split12Hour(hhmm)!;
      expect(to24HourString(p.hour12, p.minute, p.meridiem)).toBe(hhmm);
    }
  });
  it("12 AM is 00 and 12 PM is 12 (the classic off-by-twelve)", () => {
    expect(to24HourString(12, 0, "AM")).toBe("00:00");
    expect(to24HourString(12, 0, "PM")).toBe("12:00");
    expect(to24HourString(1, 30, "PM")).toBe("13:30");
    expect(to24HourString(11, 59, "PM")).toBe("23:59");
  });
  it("parse/split reject malformed values", () => {
    expect(parseHHMM("24:00")).toBeNull();
    expect(split12Hour("nope")).toBeNull();
    expect(split12Hour(null)).toBeNull();
  });
});
