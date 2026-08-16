import { describe, expect, it } from "vitest";
import { accentForActivityCount } from "../kpi-value-accent";

describe("accentForActivityCount", () => {
  it("is neutral at zero", () => {
    expect(accentForActivityCount(0)).toBe("neutral");
  });

  it("is positive once there's any activity", () => {
    expect(accentForActivityCount(1)).toBe("business");
    expect(accentForActivityCount(42)).toBe("business");
  });
});
