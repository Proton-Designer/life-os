import { describe, expect, it } from "vitest";
import { PLAN_AREAS } from "../plan-behavior";
import { planAreaChip } from "../plan-area-chip";
import { DOMAIN_ICON } from "@/lib/domain-icons";

describe("planAreaChip", () => {
  it("every plan area and 'no area' has an icon and an accent (a plan row never renders without its chip)", () => {
    for (const area of [...PLAN_AREAS, null]) {
      const chip = planAreaChip(area);
      expect(chip.icon, String(area)).toBeTruthy();
      expect(chip.accent, String(area)).toBeTruthy();
    }
  });
  it("maps onto the domain glyphs the priority rows use, so one list reads as one list", () => {
    expect(planAreaChip("business").icon).toBe(DOMAIN_ICON.business);
    expect(planAreaChip("school").icon).toBe(DOMAIN_ICON.school);
    expect(planAreaChip("work").icon).toBe(DOMAIN_ICON.co_op);
    expect(planAreaChip("body").icon).toBe(DOMAIN_ICON.fitness);
    expect(planAreaChip("faith").icon).toBe(DOMAIN_ICON.deen);
  });
  it("a line with no area gets the neutral chip", () => {
    expect(planAreaChip(null).accent).toBe("neutral");
  });
});
