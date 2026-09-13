import { describe, it, expect } from "vitest";
import { parseGradeBoundaries } from "../parse-grade-boundaries";
import { letterGradeForPct } from "../letterGrade";

describe("parseGradeBoundaries", () => {
  it("returns an empty array for null (no custom scale set)", () => {
    expect(parseGradeBoundaries(null)).toEqual([]);
  });

  it("returns an empty array for undefined", () => {
    expect(parseGradeBoundaries(undefined)).toEqual([]);
  });

  it("parses a well-formed jsonb array into GradeBoundary[]", () => {
    const raw = [
      { letter: "A", minPct: 90 },
      { letter: "B", minPct: 80 },
      { letter: "C", minPct: 70 },
    ];
    expect(parseGradeBoundaries(raw)).toEqual([
      { letter: "A", minPct: 90 },
      { letter: "B", minPct: 80 },
      { letter: "C", minPct: 70 },
    ]);
  });

  it("trims whitespace around a letter", () => {
    expect(parseGradeBoundaries([{ letter: "  A  ", minPct: 90 }])).toEqual([{ letter: "A", minPct: 90 }]);
  });

  it("drops an entry with a non-string letter, keeping the rest", () => {
    const raw = [
      { letter: "A", minPct: 90 },
      { letter: 42, minPct: 80 },
      { letter: "C", minPct: 70 },
    ];
    expect(parseGradeBoundaries(raw)).toEqual([
      { letter: "A", minPct: 90 },
      { letter: "C", minPct: 70 },
    ]);
  });

  it("drops an entry with an empty or whitespace-only letter", () => {
    expect(parseGradeBoundaries([{ letter: "   ", minPct: 90 }])).toEqual([]);
  });

  it("drops an entry with a non-numeric minPct", () => {
    expect(parseGradeBoundaries([{ letter: "A", minPct: "90" }])).toEqual([]);
  });

  it("drops an entry with a NaN or non-finite minPct", () => {
    expect(parseGradeBoundaries([{ letter: "A", minPct: NaN }])).toEqual([]);
    expect(parseGradeBoundaries([{ letter: "A", minPct: Infinity }])).toEqual([]);
  });

  it("drops a null or non-object array element instead of throwing", () => {
    expect(parseGradeBoundaries([null, "not an object", 5, { letter: "A", minPct: 90 }])).toEqual([
      { letter: "A", minPct: 90 },
    ]);
  });

  it("returns an empty array when the top-level value is not an array (defensive -- the DB CHECK should already prevent this)", () => {
    expect(parseGradeBoundaries({ letter: "A", minPct: 90 })).toEqual([]);
    expect(parseGradeBoundaries("A")).toEqual([]);
    expect(parseGradeBoundaries(42)).toEqual([]);
  });

  it("returns an empty array for an empty jsonb array", () => {
    expect(parseGradeBoundaries([])).toEqual([]);
  });

  it("round-trips into letterGradeForPct — the whole point of this parser", () => {
    const raw = [
      { letter: "A", minPct: 90 },
      { letter: "B", minPct: 80 },
      { letter: "F", minPct: 0 },
    ];
    const boundaries = parseGradeBoundaries(raw);
    expect(letterGradeForPct(95, boundaries)).toBe("A");
    expect(letterGradeForPct(85, boundaries)).toBe("B");
    expect(letterGradeForPct(10, boundaries)).toBe("F");
  });
});
