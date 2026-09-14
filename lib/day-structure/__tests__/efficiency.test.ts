import { describe, expect, it } from "vitest";
import { computeEfficiency } from "../efficiency";

describe("computeEfficiency — focused minutes over minutes since wake", () => {
  it("computes a plain fraction and rounded percent", () => {
    expect(computeEfficiency(60, 120)).toEqual({ fraction: 0.5, percent: 50 });
  });

  it("is null when there is no wake mark yet (deltaMinutes 0)", () => {
    expect(computeEfficiency(0, 0)).toBeNull();
  });

  it("is null for a negative delta rather than a negative or Infinity percent", () => {
    expect(computeEfficiency(30, -5)).toBeNull();
  });

  it("keeps the raw fraction uncapped above 1 but clamps percent to 100", () => {
    const result = computeEfficiency(180, 60);
    expect(result?.fraction).toBe(3);
    expect(result?.percent).toBe(100);
  });

  it("zero focused minutes against a real delta is a real 0%, not absent", () => {
    expect(computeEfficiency(0, 90)).toEqual({ fraction: 0, percent: 0 });
  });
});
