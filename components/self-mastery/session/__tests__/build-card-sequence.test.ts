import { describe, expect, it } from "vitest";
import { buildCardSequence, rollNextInterstitialGap } from "../build-card-sequence";
import type { SessionCard, SessionPlan } from "@/lib/self-mastery/session/types";

function card(id: string, reason: SessionCard["reason"]): SessionCard {
  return { id, lessonId: `l-${id}`, bookId: "b1", promptType: "free_recall", prompt: id, reason, queuePosition: 0 };
}

describe("buildCardSequence", () => {
  it("orders warm-up, due, then new, with the closer always last even though it was pulled from `fresh`", () => {
    const plan: SessionPlan = {
      warmUp: [card("w", "warm_up")],
      due: [card("d1", "due"), card("d2", "due")],
      fresh: [card("n1", "new")],
      closer: card("closer", "new"),
    };
    expect(buildCardSequence(plan).map((c) => c.id)).toEqual(["w", "d1", "d2", "n1", "closer"]);
  });

  it("omits the closer entirely when there isn't one, never fabricating one", () => {
    const plan: SessionPlan = { warmUp: [], due: [card("d1", "due")], fresh: [], closer: null };
    expect(buildCardSequence(plan).map((c) => c.id)).toEqual(["d1"]);
  });

  it("returns an empty sequence for a fully empty plan (the 'nothing due today' success state)", () => {
    const plan: SessionPlan = { warmUp: [], due: [], fresh: [], closer: null };
    expect(buildCardSequence(plan)).toEqual([]);
  });
});

describe("rollNextInterstitialGap", () => {
  it("only ever returns 4, 5, or 6", () => {
    for (const r of [0, 0.33, 0.66, 0.99]) {
      expect(rollNextInterstitialGap(() => r)).toBeGreaterThanOrEqual(4);
      expect(rollNextInterstitialGap(() => r)).toBeLessThanOrEqual(6);
    }
  });

  it("is deterministic for a given random source", () => {
    expect(rollNextInterstitialGap(() => 0)).toBe(4);
    expect(rollNextInterstitialGap(() => 0.999)).toBe(6);
  });
});
