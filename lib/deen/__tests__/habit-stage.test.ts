import { describe, expect, it } from "vitest";
import { habitStage, isStageOverridden, type StageOverride } from "../habit-stage";

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

  // 2026-08-25/26, item 6: a manual override wins outright over the
  // derived days-since-committed rule, in every direction.
  describe("stageOverride", () => {
    it("wins even when the derived stage would be active_build", () => {
      expect(habitStage("2026-08-01", "2026-08-01", "locked")).toBe("locked");
    });

    it("wins even when the derived stage would be locked", () => {
      expect(habitStage("2026-08-01", "2026-12-01", "active_build")).toBe("active_build");
    });

    it("wins when set to the SAME value the derived rule would already produce", () => {
      expect(habitStage("2026-08-01", "2026-08-01", "active_build")).toBe("active_build");
    });

    it("falls through to the derived rule when stageOverride is null", () => {
      expect(habitStage("2026-08-01", "2026-08-31", null)).toBe("locked");
    });

    it("falls through to the derived rule when stageOverride is omitted entirely — every existing caller compiles unchanged", () => {
      expect(habitStage("2026-08-01", "2026-08-01")).toBe("active_build");
    });

    it("falls through to the derived rule rather than throwing on a garbage stored value (unknown enum)", () => {
      const garbage = "in_progress" as StageOverride;
      expect(habitStage("2026-08-01", "2026-08-01", garbage)).toBe("active_build");
    });

    it("falls through to the derived rule rather than throwing on an empty string", () => {
      const garbage = "" as StageOverride;
      expect(habitStage("2026-08-01", "2026-08-31", garbage)).toBe("locked");
    });

    it("does not crash on a malformed committedDate even with an override set — override still wins", () => {
      expect(habitStage("not-a-date", "2026-08-01", "stabilized")).toBe("stabilized");
    });
  });
});

describe("isStageOverridden", () => {
  it("is true for each valid stage", () => {
    expect(isStageOverridden("active_build")).toBe(true);
    expect(isStageOverridden("stabilized")).toBe(true);
    expect(isStageOverridden("locked")).toBe(true);
  });

  it("is false for null", () => {
    expect(isStageOverridden(null)).toBe(false);
  });

  it("is false for a garbage value, without throwing", () => {
    expect(isStageOverridden("bogus" as StageOverride)).toBe(false);
    expect(isStageOverridden("" as StageOverride)).toBe(false);
  });
});
