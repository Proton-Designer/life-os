import { describe, expect, it } from "vitest";
import { weekDayStatus } from "../week-status";

describe("weekDayStatus", () => {
  it("a future day is always upcoming, regardless of completed", () => {
    expect(weekDayStatus("2026-08-25", "2026-08-20", false)).toBe("upcoming");
    expect(weekDayStatus("2026-08-25", "2026-08-20", true)).toBe("upcoming");
  });

  it("today is active if not completed, completed if it is", () => {
    expect(weekDayStatus("2026-08-20", "2026-08-20", false)).toBe("active");
    expect(weekDayStatus("2026-08-20", "2026-08-20", true)).toBe("completed");
  });

  it("a past day is missed if not completed, completed if it is", () => {
    expect(weekDayStatus("2026-08-18", "2026-08-20", false)).toBe("missed");
    expect(weekDayStatus("2026-08-18", "2026-08-20", true)).toBe("completed");
  });

  it("adversarial: malformed/empty date strings never throw", () => {
    expect(() => weekDayStatus("", "2026-08-20", false)).not.toThrow();
    expect(weekDayStatus("", "2026-08-20", false)).toBe("missed");
    expect(() => weekDayStatus("bogus", "bogus", false)).not.toThrow();
  });
});
