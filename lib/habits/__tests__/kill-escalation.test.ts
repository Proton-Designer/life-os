import { describe, expect, it } from "vitest";
import { KILL_REQUIRES_REASON_AFTER_VOTES, killRequiresReason } from "../kill-escalation";

describe("killRequiresReason() (P2-11)", () => {
  it("does not require a reason below the threshold", () => {
    expect(killRequiresReason(0)).toBe(false);
    expect(killRequiresReason(KILL_REQUIRES_REASON_AFTER_VOTES - 1)).toBe(false);
  });

  it("THE REGRESSION GUARD: requires a reason at and above the threshold", () => {
    expect(killRequiresReason(KILL_REQUIRES_REASON_AFTER_VOTES)).toBe(true);
    expect(killRequiresReason(KILL_REQUIRES_REASON_AFTER_VOTES + 10)).toBe(true);
  });

  it("the threshold is exactly 14 (two weeks) -- pinned so a silent change is a visible test failure", () => {
    expect(KILL_REQUIRES_REASON_AFTER_VOTES).toBe(14);
  });
});
