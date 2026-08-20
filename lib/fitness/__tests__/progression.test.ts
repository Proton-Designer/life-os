import { describe, expect, it } from "vitest";
import { proposeNextLoad } from "../progression";

describe("proposeNextLoad", () => {
  it("returns null for null input (no history)", () => {
    expect(proposeNextLoad(null)).toBeNull();
  });

  it("returns null when load is null (unloaded/bodyweight exercise)", () => {
    expect(proposeNextLoad({ load: null, reps: 10, targetRepsHigh: 10 })).toBeNull();
  });

  it("proposes an increment when the last top set hit the target reps' high end", () => {
    const result = proposeNextLoad({ load: 100, reps: 10, targetRepsHigh: 10 });
    expect(result).toBeGreaterThan(100);
  });

  it("proposes an increment when the last top set exceeded the target reps' high end", () => {
    const result = proposeNextLoad({ load: 100, reps: 12, targetRepsHigh: 10 });
    expect(result).toBeGreaterThan(100);
  });

  it("repeats the same load when the last top set fell short of the target", () => {
    expect(proposeNextLoad({ load: 100, reps: 7, targetRepsHigh: 10 })).toBe(100);
  });

  it("repeats the same load exactly one rep short of target", () => {
    expect(proposeNextLoad({ load: 100, reps: 9, targetRepsHigh: 10 })).toBe(100);
  });

  describe("adversarial inputs", () => {
    it("never returns NaN for a NaN load", () => {
      const result = proposeNextLoad({ load: NaN, reps: 10, targetRepsHigh: 10 });
      expect(result === null || Number.isFinite(result)).toBe(true);
    });

    it("returns null for Infinity load rather than proposing Infinity + increment", () => {
      const result = proposeNextLoad({ load: Infinity, reps: 10, targetRepsHigh: 10 });
      expect(result === null || Number.isFinite(result)).toBe(true);
    });

    it("returns null for -Infinity load", () => {
      const result = proposeNextLoad({ load: -Infinity, reps: 10, targetRepsHigh: 10 });
      expect(result === null || Number.isFinite(result)).toBe(true);
    });

    it("repeats the load rather than throwing when reps is NaN", () => {
      const result = proposeNextLoad({ load: 100, reps: NaN, targetRepsHigh: 10 });
      expect(result).toBe(100);
    });

    it("repeats the load rather than throwing when targetRepsHigh is NaN", () => {
      const result = proposeNextLoad({ load: 100, reps: 10, targetRepsHigh: NaN });
      expect(result).toBe(100);
    });

    it("handles a negative load without producing NaN", () => {
      const result = proposeNextLoad({ load: -20, reps: 10, targetRepsHigh: 10 });
      expect(result === null || Number.isFinite(result)).toBe(true);
    });

    it("handles a zero load (e.g. bodyweight tracked as 0 rather than null)", () => {
      const result = proposeNextLoad({ load: 0, reps: 10, targetRepsHigh: 10 });
      expect(result).toBeGreaterThan(0);
    });
  });
});
