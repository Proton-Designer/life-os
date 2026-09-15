import { describe, expect, it } from "vitest";
import { buildCardSequence, buildInterleavedSequence, rollNextInterstitialGap } from "../build-card-sequence";
import type { SessionCard, SessionPlan, SessionQuestion } from "@/lib/self-mastery/session/types";

function card(id: string, reason: SessionCard["reason"], queuePosition = 0): SessionCard {
  return { id, lessonId: `l-${id}`, bookId: "b1", promptType: "free_recall", prompt: id, reason, queuePosition };
}

function question(id: string, reason: SessionQuestion["reason"], queuePosition: number): SessionQuestion {
  return { id, classId: "c1", prompt: id, reason, queuePosition };
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

// Phase 1 #25 required addition (Opus Lead): INTERLEAVE, don't append. get_session_queue
// already round-robins book/course sources by queue_position; a naive "cards then
// questions" append would throw that interleaving away.
describe("buildInterleavedSequence", () => {
  it("orders cards and questions by their shared queuePosition, not by kind", () => {
    const plan: SessionPlan = {
      warmUp: [card("w", "warm_up", 0)],
      due: [card("d1", "due", 2), card("d2", "due", 4)],
      fresh: [],
      closer: null,
    };
    const questions = [question("q1", "due", 1), question("q2", "due", 3)];
    // book(0) -> question(1) -> book(2) -> question(3) -> book(4): genuinely
    // interleaved, matching what a round-robin-by-source queue_position implies.
    const sequence = buildInterleavedSequence(plan, questions);
    expect(sequence.map((s) => s.item.id)).toEqual(["w", "q1", "d1", "q2", "d2"]);
    expect(sequence.map((s) => s.kind)).toEqual(["card", "question", "card", "question", "card"]);
  });

  it("keeps the closer pinned last regardless of queuePosition, exactly like buildCardSequence", () => {
    const plan: SessionPlan = {
      warmUp: [],
      due: [card("d1", "due", 5)],
      fresh: [],
      closer: card("closer", "new", 1), // a low queuePosition -- must NOT sort ahead of d1
    };
    const questions = [question("q1", "due", 2)];
    // q1 (position 2) sorts ahead of d1 (position 5) — the interleave itself is
    // correct; only the closer's own position (1) is ignored, since it's pinned last.
    expect(buildInterleavedSequence(plan, questions).map((s) => s.item.id)).toEqual(["q1", "d1", "closer"]);
  });

  it("never mutates plan.warmUp/due/fresh's own card-lesson-adjacency order -- only decides where questions slot in", () => {
    const plan: SessionPlan = { warmUp: [], due: [card("d1", "due", 1), card("d2", "due", 0)], fresh: [], closer: null };
    // d2's queuePosition (0) is lower than d1's (1) but plan.due's own order (already
    // repaired by repairLessonAdjacency) is left completely untouched when there are
    // no questions to interleave -- this function must not re-sort cards among
    // themselves, only merge questions in by position.
    expect(buildInterleavedSequence(plan, []).map((s) => s.item.id)).toEqual(["d1", "d2"]);
  });

  it("returns an empty sequence for a fully empty plan with no due questions either", () => {
    const plan: SessionPlan = { warmUp: [], due: [], fresh: [], closer: null };
    expect(buildInterleavedSequence(plan, [])).toEqual([]);
  });

  it("still produces a real sequence from questions alone, for a School-only user with zero book cards", () => {
    const plan: SessionPlan = { warmUp: [], due: [], fresh: [], closer: null };
    const questions = [question("q1", "new", 0), question("q2", "new", 1)];
    expect(buildInterleavedSequence(plan, questions).map((s) => s.item.id)).toEqual(["q1", "q2"]);
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
