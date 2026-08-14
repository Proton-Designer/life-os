import { describe, expect, it } from "vitest";
import { RIGHT_NOW_WINDOW_MS, urgencyBucket } from "../urgency";

describe("urgencyBucket", () => {
  it("returns later_today for a null dueAt", () => {
    expect(urgencyBucket(null, new Date("2026-08-13T12:00:00Z"))).toBe("later_today");
  });

  it("returns right_now when dueAt is within the 2-hour window", () => {
    const now = new Date("2026-08-13T12:00:00Z");
    const dueAt = new Date(now.getTime() + RIGHT_NOW_WINDOW_MS - 1);
    expect(urgencyBucket(dueAt, now)).toBe("right_now");
  });

  it("returns right_now when dueAt is already overdue", () => {
    const now = new Date("2026-08-13T12:00:00Z");
    const dueAt = new Date(now.getTime() - 60_000);
    expect(urgencyBucket(dueAt, now)).toBe("right_now");
  });

  it("returns later_today when dueAt is beyond the 2-hour window", () => {
    const now = new Date("2026-08-13T12:00:00Z");
    const dueAt = new Date(now.getTime() + RIGHT_NOW_WINDOW_MS + 1);
    expect(urgencyBucket(dueAt, now)).toBe("later_today");
  });
});
