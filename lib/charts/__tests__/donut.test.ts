import { describe, expect, it } from "vitest";
import { computeDonutLayout } from "../donut";

describe("computeDonutLayout", () => {
  it("splits the circumference proportionally to each slice's value", () => {
    const layout = computeDonutLayout(
      [
        { label: "Signal", value: 3, colorVar: "--accent-business" },
        { label: "Noise", value: 1, colorVar: "--accent-noise" },
      ],
      100
    );
    expect(layout[0].pct).toBe(75);
    expect(layout[1].pct).toBe(25);
  });

  it("dash-arrays sum to the full circumference for each slice (arc-length, gap-length)", () => {
    const layout = computeDonutLayout(
      [
        { label: "A", value: 1, colorVar: "--accent-business" },
        { label: "B", value: 1, colorVar: "--accent-noise" },
      ],
      100
    );
    expect(layout[0].dashArray).toBe("50 50");
    expect(layout[1].dashArray).toBe("50 50");
  });

  it("offsets each slice by the cumulative length of the slices before it", () => {
    const layout = computeDonutLayout(
      [
        { label: "A", value: 1, colorVar: "--accent-business" },
        { label: "B", value: 1, colorVar: "--accent-noise" },
        { label: "C", value: 2, colorVar: "--accent-deen" },
      ],
      100
    );
    expect(layout[0].dashOffset).toBe(-0);
    expect(layout[1].dashOffset).toBe(-25);
    expect(layout[2].dashOffset).toBe(-50);
  });

  it("handles an all-zero total without dividing by zero", () => {
    const layout = computeDonutLayout(
      [
        { label: "A", value: 0, colorVar: "--accent-business" },
        { label: "B", value: 0, colorVar: "--accent-noise" },
      ],
      100
    );
    expect(layout[0].pct).toBe(0);
    expect(layout[1].pct).toBe(0);
  });

  it("returns an empty layout for an empty slice list", () => {
    expect(computeDonutLayout([], 100)).toEqual([]);
  });
});
