import { describe, expect, it } from "vitest";
import { deriveDayBand } from "../day-band";
import type { RiskBand } from "../assignment-risk";

// Mirrors CollegeOS packages/core/src/risk/dayBand.test.ts, adapted to this port's
// simplified `{ band }` input shape (see day-band.ts's own comment for why).

describe("deriveDayBand", () => {
  it("returns null for an empty list — no computed risk means no atmosphere", () => {
    expect(deriveDayBand([])).toBeNull();
  });

  it("returns the only band when there is exactly one item", () => {
    expect(deriveDayBand([{ band: "moderate" }])).toBe("moderate");
  });

  it.each([
    ["low", ["low", "low"]],
    ["moderate", ["low", "moderate", "low"]],
    ["high", ["low", "high", "moderate"]],
    ["critical", ["critical", "low"]],
  ] as const)("takes the maximum band, not the first or last: %s", (expected, bands) => {
    expect(deriveDayBand(bands.map((b) => ({ band: b })))).toBe(expected);
  });

  it("is order-independent", () => {
    const ascending = ["low", "moderate", "high"] as const;
    const descending = ["high", "moderate", "low"] as const;
    expect(deriveDayBand(ascending.map((band) => ({ band })))).toBe(deriveDayBand(descending.map((band) => ({ band }))));
  });

  it("lets a single critical item characterise a day full of low ones", () => {
    const risks = [...Array<RiskBand>(9).fill("low"), "critical" as const].map((band) => ({ band }));
    expect(deriveDayBand(risks)).toBe("critical");
  });
});
