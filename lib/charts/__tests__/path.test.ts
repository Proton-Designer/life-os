import { describe, expect, it } from "vitest";
import { buildLinePath, buildAreaPath } from "../path";

describe("buildLinePath", () => {
  it("starts with M and connects the rest with L", () => {
    expect(buildLinePath([{ x: 0, y: 10 }, { x: 5, y: 5 }, { x: 10, y: 0 }])).toBe(
      "M0,10 L5,5 L10,0"
    );
  });

  it("returns an empty string for zero points", () => {
    expect(buildLinePath([])).toBe("");
  });

  it("handles a single point (just a move, no line)", () => {
    expect(buildLinePath([{ x: 3, y: 3 }])).toBe("M3,3");
  });
});

describe("buildAreaPath", () => {
  it("closes the line down to the baseline and back to the first point", () => {
    const path = buildAreaPath([{ x: 0, y: 10 }, { x: 10, y: 0 }], 20);
    expect(path).toBe("M0,10 L10,0 L10,20 L0,20 Z");
  });

  it("returns an empty string for zero points", () => {
    expect(buildAreaPath([], 20)).toBe("");
  });
});
