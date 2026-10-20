import { describe, expect, it } from "vitest";
import { parseStartAt } from "../start-at";

describe("parseStartAt", () => {
  it("accepts whole non-negative numbers, including 0 and the first of repeated params", () => {
    expect(parseStartAt("0")).toBe(0);
    expect(parseStartAt("1200")).toBe(1200);
    expect(parseStartAt(["5", "9"])).toBe(5);
  });
  it("empty, blank, missing, negative, fractional and junk all mean no jump (positive control: '0' above is a jump)", () => {
    for (const v of ["", "  ", undefined, "-3", "1.5", "abc", "1e3x", []]) expect(parseStartAt(v as string | undefined), String(v)).toBeNull();
  });
});
