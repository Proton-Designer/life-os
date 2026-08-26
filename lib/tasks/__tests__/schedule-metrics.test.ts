import { describe, expect, it } from "vitest";
import { countScheduledThisWeek } from "../schedule-metrics";
import type { CancelledDatesByEvent } from "../schedule-cancellations";

const weekDates = ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"];
const noCancellations: CancelledDatesByEvent = new Map();

describe("countScheduledThisWeek", () => {
  it("counts a recurring event once for the week, on its day", () => {
    const count = countScheduledThisWeek(
      [{ id: "e1", isRecurring: true, dayOfWeek: 1, eventDate: null }],
      weekDates,
      noCancellations
    );
    expect(count).toBe(1);
  });

  it("excludes a recurring event cancelled for this week's specific occurrence", () => {
    const cancelledDates: CancelledDatesByEvent = new Map([["e1", new Set(["2026-08-10"])]]);
    const count = countScheduledThisWeek(
      [{ id: "e1", isRecurring: true, dayOfWeek: 1, eventDate: null }],
      weekDates,
      cancelledDates
    );
    expect(count).toBe(0);
  });

  it("counts a one-off event whose date falls in this week", () => {
    const count = countScheduledThisWeek(
      [{ id: "e1", isRecurring: false, dayOfWeek: null, eventDate: "2026-08-12" }],
      weekDates,
      noCancellations
    );
    expect(count).toBe(1);
  });

  it("excludes a one-off event dated outside this week", () => {
    const count = countScheduledThisWeek(
      [{ id: "e1", isRecurring: false, dayOfWeek: null, eventDate: "2026-09-01" }],
      weekDates,
      noCancellations
    );
    expect(count).toBe(0);
  });

  it("returns 0 for no events", () => {
    expect(countScheduledThisWeek([], weekDates, noCancellations)).toBe(0);
  });
});
