import { describe, expect, it } from "vitest";
import { taskDayFor } from "../task-day";

const TZ = "America/Chicago";
// Oct 10 2026 is CDT (UTC-5): 23:30 local = 04:30Z next day; 00:30 local Oct 11 = 05:30Z; 05:00 local Oct 11 = 10:00Z.
const at = (iso: string) => new Date(iso);
const none = new Set<string>();

describe("taskDayFor: an unfinished day stays until it is closed or 4 AM", () => {
  it("evening: still the same day", () => {
    expect(taskDayFor(at("2026-10-11T04:30:00Z"), TZ, none)).toBe("2026-10-10");
  });
  it("12:30 AM after midnight: still YESTERDAY's list (not rolled at midnight)", () => {
    expect(taskDayFor(at("2026-10-11T05:30:00Z"), TZ, none)).toBe("2026-10-10");
  });
  it("after 4 AM: the new day", () => {
    expect(taskDayFor(at("2026-10-11T10:00:00Z"), TZ, none)).toBe("2026-10-11");
  });
  it("once the day is closed (even at 10 PM), the list moves to tomorrow", () => {
    expect(taskDayFor(at("2026-10-11T03:00:00Z"), TZ, new Set(["2026-10-10"]))).toBe("2026-10-11");
  });
  it("closing at 1 AM closes the previous day and lands on the current date", () => {
    expect(taskDayFor(at("2026-10-11T06:00:00Z"), TZ, new Set(["2026-10-10"]))).toBe("2026-10-11");
  });
  it("a close mark for a different day changes nothing", () => {
    expect(taskDayFor(at("2026-10-11T04:30:00Z"), TZ, new Set(["2026-10-09"]))).toBe("2026-10-10");
  });
});
