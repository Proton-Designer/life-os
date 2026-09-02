import { describe, expect, it } from "vitest";
import { letterGradeForPct, type GradeBoundary } from "../letterGrade";

const boundaries: GradeBoundary[] = [
  { letter: "A", minPct: 93 },
  { letter: "A-", minPct: 90 },
  { letter: "B+", minPct: 87 },
  { letter: "B", minPct: 83 },
  { letter: "B-", minPct: 80 },
  { letter: "F", minPct: 0 },
];

describe("letterGradeForPct", () => {
  it("uses inclusive lower bounds", () => {
    expect(letterGradeForPct(93, boundaries)).toBe("A");
    expect(letterGradeForPct(92.99, boundaries)).toBe("A-");
  });

  it("picks the highest matching boundary", () => {
    expect(letterGradeForPct(99, boundaries)).toBe("A");
  });

  it("falls through to the lowest boundary for a failing percentage", () => {
    expect(letterGradeForPct(10, boundaries)).toBe("F");
  });

  it("works regardless of input boundary order", () => {
    const shuffled = [...boundaries].reverse();
    expect(letterGradeForPct(85, shuffled)).toBe("B");
  });

  it("throws on an empty boundary list", () => {
    expect(() => letterGradeForPct(85, [])).toThrow();
  });
});
