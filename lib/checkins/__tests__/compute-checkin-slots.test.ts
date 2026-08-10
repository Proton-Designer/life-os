import { describe, expect, it } from "vitest";
import { computeCheckinSlots } from "../compute-checkin-slots";

const TZ = "America/Chicago"; // UTC-5 (CDT) on this date

describe("computeCheckinSlots", () => {
  it("generates fixed clock-time slots for the window/interval", () => {
    const now = new Date("2026-08-10T13:00:00Z"); // 08:00 CDT
    const result = computeCheckinSlots("08:00", "22:00", 120, now, {
      timezone: TZ,
      answeredSlotTimes: [],
      paused: false,
    });

    // 8/10/12/2/4/6/8/10 = 8 slots, per spec's example.
    expect(result.slots).toHaveLength(8);
  });

  it("marks the most recent fired-but-unanswered slot as due", () => {
    const now = new Date("2026-08-10T15:30:00Z"); // 10:30 CDT — between the 10:00 and 12:00 slots
    const result = computeCheckinSlots("08:00", "22:00", 120, now, {
      timezone: TZ,
      answeredSlotTimes: [],
      paused: false,
    });

    // The 08:00 and 10:00 slots have fired; 10:00 (most recent) is due.
    expect(result.dueSlot).not.toBeNull();
    expect(result.dueSlot?.toISOString()).toBe(new Date("2026-08-10T15:00:00Z").toISOString());
  });

  it("locks an older unanswered slot as missed once a newer slot has fired (grace period)", () => {
    const now = new Date("2026-08-10T17:30:00Z"); // 12:30 CDT — 08:00, 10:00, and 12:00 have all fired
    const result = computeCheckinSlots("08:00", "22:00", 120, now, {
      timezone: TZ,
      answeredSlotTimes: [],
      paused: false,
    });

    // 12:00 (most recent fired) is due; 08:00 and 10:00 are now locked as missed.
    expect(result.dueSlot?.toISOString()).toBe(new Date("2026-08-10T17:00:00Z").toISOString());
    expect(result.missedSlots).toHaveLength(2);
  });

  it("does not re-flag an already-answered slot as due or missed", () => {
    const now = new Date("2026-08-10T15:30:00Z"); // 10:30 CDT
    const answeredEight = new Date("2026-08-10T13:00:00Z"); // 08:00 CDT slot, already answered
    const result = computeCheckinSlots("08:00", "22:00", 120, now, {
      timezone: TZ,
      answeredSlotTimes: [answeredEight],
      paused: false,
    });

    expect(result.dueSlot?.toISOString()).toBe(new Date("2026-08-10T15:00:00Z").toISOString());
    expect(result.missedSlots).toHaveLength(0);
  });

  it("suppresses all triggers when paused for today", () => {
    const now = new Date("2026-08-10T17:30:00Z");
    const result = computeCheckinSlots("08:00", "22:00", 120, now, {
      timezone: TZ,
      answeredSlotTimes: [],
      paused: true,
    });

    expect(result.dueSlot).toBeNull();
    expect(result.missedSlots).toHaveLength(0);
  });
});
