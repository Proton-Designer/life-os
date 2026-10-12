import { describe, expect, it } from "vitest";
import { weeklyGoalDomains } from "../weekly-goal-domains";

describe("weeklyGoalDomains", () => {
  it("is both slots for everyone: the Personal (deen-keyed) goal does not depend on Faith, and Business is unconditional", () => {
    expect(weeklyGoalDomains()).toEqual(["deen", "business"]);
  });
});
