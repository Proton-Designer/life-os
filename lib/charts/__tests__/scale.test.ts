import { describe, expect, it } from "vitest";
import { scaleLinear, niceTicks } from "../scale";

describe("scaleLinear", () => {
  it("maps the domain's endpoints to the range's endpoints", () => {
    const scale = scaleLinear([0, 100], [0, 300]);
    expect(scale(0)).toBe(0);
    expect(scale(100)).toBe(300);
  });

  it("interpolates linearly between endpoints", () => {
    const scale = scaleLinear([0, 100], [0, 300]);
    expect(scale(50)).toBe(150);
  });

  it("handles an inverted range (e.g. y-down pixel space)", () => {
    const scale = scaleLinear([0, 10], [200, 0]);
    expect(scale(0)).toBe(200);
    expect(scale(10)).toBe(0);
    expect(scale(5)).toBe(100);
  });

  it("does not divide by zero when the domain is a single point", () => {
    const scale = scaleLinear([5, 5], [0, 100]);
    expect(scale(5)).toBe(0);
  });

  it("extrapolates for values outside the domain", () => {
    const scale = scaleLinear([0, 10], [0, 100]);
    expect(scale(15)).toBe(150);
    expect(scale(-5)).toBe(-50);
  });
});

describe("niceTicks", () => {
  it("produces clean, evenly-spaced round numbers spanning the data", () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("rounds the max up and min down to the nearest step, never clipping data", () => {
    const ticks = niceTicks(3, 87, 5);
    expect(ticks[0]).toBeLessThanOrEqual(3);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(87);
  });

  it("returns a single tick when min equals max", () => {
    expect(niceTicks(5, 5, 5)).toEqual([5]);
  });

  it("every step is the same size", () => {
    const ticks = niceTicks(0, 43, 6);
    const steps = ticks.slice(1).map((t, i) => t - ticks[i]);
    const first = steps[0];
    for (const step of steps) {
      expect(step).toBeCloseTo(first);
    }
  });
});
