import { describe, expect, it } from "vitest";
import { computeSessionCheckinSlots } from "../compute-session-checkin-slots";

describe("computeSessionCheckinSlots", () => {
  it("generates no slots before the first interval has elapsed", () => {
    const startedAt = new Date("2026-08-15T14:00:00Z");
    const now = new Date("2026-08-15T14:30:00Z"); // 30 min in, interval is 60
    const result = computeSessionCheckinSlots(startedAt, 60, now, []);

    expect(result.slots).toHaveLength(0);
    expect(result.dueSlot).toBeNull();
    expect(result.missedSlots).toHaveLength(0);
  });

  it("generates session-relative slots (started_at + N*interval), not fixed clock times", () => {
    const startedAt = new Date("2026-08-15T14:00:00Z");
    const now = new Date("2026-08-15T17:00:00Z"); // 3 hours in
    const result = computeSessionCheckinSlots(startedAt, 60, now, []);

    expect(result.slots.map((s) => s.toISOString())).toEqual([
      "2026-08-15T15:00:00.000Z",
      "2026-08-15T16:00:00.000Z",
      "2026-08-15T17:00:00.000Z",
    ]);
  });

  it("marks the most recent fired-but-unanswered slot as due", () => {
    const startedAt = new Date("2026-08-15T14:00:00Z");
    const now = new Date("2026-08-15T16:30:00Z"); // between the 2nd and 3rd hourly slot
    const result = computeSessionCheckinSlots(startedAt, 60, now, []);

    // 15:00 and 16:00 have fired; 16:00 (most recent) is due.
    expect(result.dueSlot?.toISOString()).toBe("2026-08-15T16:00:00.000Z");
  });

  it("locks an older unanswered slot as missed once a newer slot has fired (grace period)", () => {
    const startedAt = new Date("2026-08-15T14:00:00Z");
    const now = new Date("2026-08-15T17:30:00Z"); // 15:00, 16:00, 17:00 have all fired
    const result = computeSessionCheckinSlots(startedAt, 60, now, []);

    expect(result.dueSlot?.toISOString()).toBe("2026-08-15T17:00:00.000Z");
    expect(result.missedSlots.map((s) => s.toISOString())).toEqual([
      "2026-08-15T15:00:00.000Z",
      "2026-08-15T16:00:00.000Z",
    ]);
  });

  it("does not re-flag an already-answered slot as due or missed", () => {
    const startedAt = new Date("2026-08-15T14:00:00Z");
    const now = new Date("2026-08-15T16:30:00Z");
    const answeredFifteen = new Date("2026-08-15T15:00:00Z");
    const result = computeSessionCheckinSlots(startedAt, 60, now, [answeredFifteen]);

    expect(result.dueSlot?.toISOString()).toBe("2026-08-15T16:00:00.000Z");
    expect(result.missedSlots).toHaveLength(0);
  });

  it("has no due/missed slots once every fired slot has been answered", () => {
    const startedAt = new Date("2026-08-15T14:00:00Z");
    const now = new Date("2026-08-15T16:30:00Z");
    const answered = [new Date("2026-08-15T15:00:00Z"), new Date("2026-08-15T16:00:00Z")];
    const result = computeSessionCheckinSlots(startedAt, 60, now, answered);

    expect(result.dueSlot).toBeNull();
    expect(result.missedSlots).toHaveLength(0);
  });

  it("keeps generating slots indefinitely as the session stays active (unbounded end)", () => {
    const startedAt = new Date("2026-08-15T14:00:00Z");
    const now = new Date("2026-08-15T23:00:00Z"); // 9 hours in
    const result = computeSessionCheckinSlots(startedAt, 60, now, []);

    expect(result.slots).toHaveLength(9);
  });
});
