import { describe, expect, it } from "vitest";
import { RIGHT_NOW_WINDOW_MS, classifyUrgency } from "../urgency";

describe("classifyUrgency", () => {
  // A2 wiring, R18(4): the sole classifier now that the old two-state
  // urgencyBucket function (which defaulted a null dueAt to
  // "later_today") is retired. A missing dueAt is genuinely absent
  // evidence, not a bucket.
  it("returns 'absent' for a null dueAt -- never a defaulted bucket", () => {
    expect(classifyUrgency(null, new Date("2026-08-13T12:00:00Z"))).toBe("absent");
  });

  it("returns right_now when dueAt is within the 2-hour window", () => {
    const now = new Date("2026-08-13T12:00:00Z");
    const dueAt = new Date(now.getTime() + RIGHT_NOW_WINDOW_MS - 1);
    expect(classifyUrgency(dueAt, now)).toBe("right_now");
  });

  it("returns right_now when dueAt is already overdue", () => {
    const now = new Date("2026-08-13T12:00:00Z");
    const dueAt = new Date(now.getTime() - 60_000);
    expect(classifyUrgency(dueAt, now)).toBe("right_now");
  });

  it("returns later_today when dueAt is beyond the 2-hour window", () => {
    const now = new Date("2026-08-13T12:00:00Z");
    const dueAt = new Date(now.getTime() + RIGHT_NOW_WINDOW_MS + 1);
    expect(classifyUrgency(dueAt, now)).toBe("later_today");
  });
});
