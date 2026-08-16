import { describe, expect, it } from "vitest";
import { countScheduledThisWeek } from "../schedule-metrics";

const weekDates = ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"];

describe("countScheduledThisWeek", () => {
  it("counts a recurring event once for the week, on its day", () => {
    const count = countScheduledThisWeek(
      [{ isRecurring: true, dayOfWeek: 1, eventDate: null, cancelledOn: null }],
      weekDates
    );
    expect(count).toBe(1);
  });

  it("excludes a recurring event cancelled for this week's specific occurrence", () => {
    const count = countScheduledThisWeek(
      [{ isRecurring: true, dayOfWeek: 1, eventDate: null, cancelledOn: "2026-08-10" }],
      weekDates
    );
    expect(count).toBe(0);
  });

  it("counts a one-off event whose date falls in this week", () => {
    const count = countScheduledThisWeek(
      [{ isRecurring: false, dayOfWeek: null, eventDate: "2026-08-12", cancelledOn: null }],
      weekDates
    );
    expect(count).toBe(1);
  });

  it("excludes a one-off event dated outside this week", () => {
    const count = countScheduledThisWeek(
      [{ isRecurring: false, dayOfWeek: null, eventDate: "2026-09-01", cancelledOn: null }],
      weekDates
    );
    expect(count).toBe(0);
  });

  it("returns 0 for no events", () => {
    expect(countScheduledThisWeek([], weekDates)).toBe(0);
  });
});
