import { describe, expect, it } from "vitest";
import { computeFocusTimeMinutes } from "../focus-time";

describe("computeFocusTimeMinutes", () => {
  it("sums completed session durations", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    const minutes = computeFocusTimeMinutes(
      [
        { startedAt: new Date("2026-08-15T09:00:00Z"), endedAt: new Date("2026-08-15T09:30:00Z") },
        { startedAt: new Date("2026-08-15T10:00:00Z"), endedAt: new Date("2026-08-15T10:45:00Z") },
      ],
      now
    );
    expect(minutes).toBe(75);
  });

  it("treats an ongoing (unended) session as running until now", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    const minutes = computeFocusTimeMinutes(
      [{ startedAt: new Date("2026-08-15T11:30:00Z"), endedAt: null }],
      now
    );
    expect(minutes).toBe(30);
  });

  it("returns 0 for no sessions", () => {
    expect(computeFocusTimeMinutes([], new Date())).toBe(0);
  });
});
