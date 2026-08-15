import { describe, expect, it } from "vitest";
import { habitStage } from "../habit-stage";

describe("habitStage", () => {
  it("is active_build on the day it's committed (0 days elapsed)", () => {
    expect(habitStage("2026-08-01", "2026-08-01")).toBe("active_build");
  });

  it("is active_build through day 13", () => {
    expect(habitStage("2026-08-01", "2026-08-14")).toBe("active_build");
  });

  it("becomes stabilized on day 14", () => {
    expect(habitStage("2026-08-01", "2026-08-15")).toBe("stabilized");
  });

  it("is stabilized through day 29", () => {
    expect(habitStage("2026-08-01", "2026-08-30")).toBe("stabilized");
  });

  it("becomes locked on day 30", () => {
    expect(habitStage("2026-08-01", "2026-08-31")).toBe("locked");
  });

  it("stays locked well past day 30", () => {
    expect(habitStage("2026-08-01", "2026-12-01")).toBe("locked");
  });
});
