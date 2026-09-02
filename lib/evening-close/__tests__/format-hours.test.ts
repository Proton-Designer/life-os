import { describe, expect, it } from "vitest";
import { formatHoursMinutes } from "../format-hours";

/**
 * R58 specifies h:mm for the close's Hours line. Deliberately NOT reusing
 * formatElapsedDuration ("1h 25m"), which is the Lock-In stopwatch's
 * convention — changing that to serve this screen would alter a surface
 * nobody asked me to touch, and two formats in one app is a smaller cost than
 * one format that is wrong in one of its two homes.
 */
describe("formatHoursMinutes — h:mm", () => {
  it("pads the minutes", () => {
    expect(formatHoursMinutes(130)).toBe("2:10");
    expect(formatHoursMinutes(65)).toBe("1:05");
  });

  it("shows a zero hour rather than bare minutes", () => {
    expect(formatHoursMinutes(45)).toBe("0:45");
  });

  it("zero is a real value, not an empty string", () => {
    expect(formatHoursMinutes(0)).toBe("0:00");
  });

  it("exact hours still carry :00", () => {
    expect(formatHoursMinutes(120)).toBe("2:00");
  });

  it("handles more than a day without rolling over", () => {
    expect(formatHoursMinutes(1500)).toBe("25:00");
  });

  // Defensive: computeFocusTimeMinutes can only return >= 0, but this is a
  // separate entry point and a negative would render "-1:-30" without this.
  it("clamps a negative to zero rather than rendering nonsense", () => {
    expect(formatHoursMinutes(-30)).toBe("0:00");
  });

  it("floors partial minutes, matching every other duration in the app", () => {
    expect(formatHoursMinutes(90.9)).toBe("1:30");
  });
});
