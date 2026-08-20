import { describe, expect, it } from "vitest";
import { isGoalActiveOn, repGoalProgress } from "../rep-goal";

describe("repGoalProgress", () => {
  it("computes a normal in-progress fraction", () => {
    const result = repGoalProgress(18, 30);
    expect(result).toEqual({ done: 18, target: 30, fraction: 0.6, complete: false });
  });

  it("is complete when done meets target exactly", () => {
    expect(repGoalProgress(30, 30).complete).toBe(true);
  });

  it("reports the real overshoot in `done`, not clamped to target", () => {
    const result = repGoalProgress(35, 30);
    expect(result.done).toBe(35);
    expect(result.complete).toBe(true);
  });

  it("clamps `fraction` to 1 on an overshoot day (nowhere for it to go on a progress bar)", () => {
    expect(repGoalProgress(35, 30).fraction).toBe(1);
  });

  it("is zero-progress, not complete, for zero logged reps", () => {
    expect(repGoalProgress(0, 30)).toEqual({ done: 0, target: 30, fraction: 0, complete: false });
  });

  describe("adversarial inputs", () => {
    it("treats a NaN logged-reps as 0 done, not NaN", () => {
      const result = repGoalProgress(NaN, 30);
      expect(result.done).toBe(0);
      expect(Number.isFinite(result.fraction)).toBe(true);
    });

    it("treats a negative logged-reps as 0 done", () => {
      expect(repGoalProgress(-5, 30).done).toBe(0);
    });

    it("treats Infinity logged-reps as 0 done rather than an infinite overshoot", () => {
      const result = repGoalProgress(Infinity, 30);
      expect(Number.isFinite(result.done)).toBe(true);
    });

    it("a zero or negative target never produces a divide-by-zero NaN fraction", () => {
      expect(repGoalProgress(10, 0)).toEqual({ done: 10, target: 0, fraction: 0, complete: false });
      expect(repGoalProgress(10, -5)).toEqual({ done: 10, target: 0, fraction: 0, complete: false });
    });

    it("a NaN target does not propagate into fraction", () => {
      const result = repGoalProgress(10, NaN);
      expect(Number.isFinite(result.fraction)).toBe(true);
      expect(result.target).toBe(0);
    });
  });
});

describe("isGoalActiveOn", () => {
  it("is active on a listed day", () => {
    expect(isGoalActiveOn([1, 2, 3, 4, 5], 3)).toBe(true);
  });

  it("is inactive on a weekend day not in the list (the starter plan's weekday-only shape)", () => {
    expect(isGoalActiveOn([1, 2, 3, 4, 5], 0)).toBe(false);
    expect(isGoalActiveOn([1, 2, 3, 4, 5], 6)).toBe(false);
  });

  it("returns false, not a throw, for a non-array activeDays", () => {
    expect(isGoalActiveOn(null as unknown as number[], 3)).toBe(false);
    expect(isGoalActiveOn(undefined as unknown as number[], 3)).toBe(false);
  });

  it("returns false for an empty active-days list", () => {
    expect(isGoalActiveOn([], 3)).toBe(false);
  });
});
