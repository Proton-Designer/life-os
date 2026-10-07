import { describe, expect, it } from "vitest";
import { addMinutesToHHMM, ceilHHMMToStep, floorHHMMToStep, localClockHHMM } from "@/lib/date-utils";

describe("localClockHHMM", () => {
  it("reads the wall clock of the given timezone, 24-hour", () => {
    const instant = new Date("2026-10-07T03:30:00Z"); // 11:30 PM the previous evening in New York (EDT), 3:30 AM UTC
    expect(localClockHHMM(instant, "America/New_York")).toBe("23:30");
    expect(localClockHHMM(instant, "UTC")).toBe("03:30");
  });
  it("midnight is 00:00, never 24:00", () => {
    expect(localClockHHMM(new Date("2026-10-07T00:00:00Z"), "UTC")).toBe("00:00");
  });
});

describe("addMinutesToHHMM", () => {
  it("adds and wraps both ways", () => {
    expect(addMinutesToHHMM("09:00", 30)).toBe("09:30");
    expect(addMinutesToHHMM("23:45", 30)).toBe("00:15");
    expect(addMinutesToHHMM("00:10", -30)).toBe("23:40");
    expect(addMinutesToHHMM("nope", 5)).toBe("nope");
  });
});

describe("ceilHHMMToStep", () => {
  it("rounds up to the next step", () => {
    expect(ceilHHMMToStep("21:47", 5)).toBe("21:50");
    expect(ceilHHMMToStep("21:50", 5)).toBe("21:50");
    expect(ceilHHMMToStep("23:58", 5)).toBe("00:00");
  });
});

describe("floorHHMMToStep", () => {
  it("rounds down to the step and never past the input", () => {
    expect(floorHHMMToStep("21:47", 5)).toBe("21:45");
    expect(floorHHMMToStep("21:50", 5)).toBe("21:50");
    expect(floorHHMMToStep("00:03", 5)).toBe("00:00");
    expect(floorHHMMToStep("nope", 5)).toBe("nope");
  });
});
