import { describe, expect, it } from "vitest";
import { promotionCandidates, type PromotionRow } from "../promotion-candidates";

const NOW = new Date("2026-09-02T15:00:00Z"); // 10:00 CDT

const row = (over: Partial<PromotionRow> = {}): PromotionRow => ({
  id: "p1",
  acceptedText: "Read one page before opening the laptop",
  area: "learning",
  cueTime: null,
  verdictDueAt: "2026-09-30T05:00:00Z",
  retiredAt: null,
  ...over,
});

/**
 * R30: `lesson_promotions` IS a commitment — the fourth lifecycle, the
 * time-boxed experiment. The read model gains promotions as a candidate
 * source: window = its cue, urgency = `verdict_due_at`.
 */
describe("promotionCandidates — a promotion is a commitment, not a lesson", () => {
  it("carries the accepted text as the candidate's title, not the lesson's", () => {
    const [c] = promotionCandidates([row()], NOW);
    expect(c.title).toBe("Read one page before opening the laptop");
  });

  it("urgency comes from verdict_due_at", () => {
    const [c] = promotionCandidates([row({ verdictDueAt: "2026-09-30T05:00:00Z" })], NOW);
    expect(c.dueAt).toBe("2026-09-30T05:00:00Z");
  });

  it("the window is the cue when one is set", () => {
    const [c] = promotionCandidates([row({ cueTime: "07:30" })], NOW);
    expect(c.cueTime).toBe("07:30");
  });

  /**
   * ABSENT, NOT DEFAULTED. R30 makes cadence/cue OPTIONAL. A promotion without
   * a cue is anytime — it must not be given a fabricated window, because a
   * window is what the arbiter uses to decide "is this due NOW", and inventing
   * one would make an anytime experiment compete for a slot it never claimed.
   */
  it("no cue means no window — never a defaulted one", () => {
    const [c] = promotionCandidates([row({ cueTime: null })], NOW);
    expect(c.cueTime).toBeNull();
  });

  /**
   * `retired_at` has a single writer (a trigger from the verdict insert) and
   * is set iff a terminal verdict exists. A retired promotion is finished: it
   * is not a candidate, and it is not an error either.
   */
  it("a retired promotion is not a candidate", () => {
    expect(promotionCandidates([row({ retiredAt: "2026-09-20T00:00:00Z" })], NOW)).toEqual([]);
  });

  it("an overdue verdict is still a candidate — the experiment needs judging", () => {
    const [c] = promotionCandidates([row({ verdictDueAt: "2026-08-30T05:00:00Z" })], NOW);
    expect(c).toBeDefined();
    expect(c.dueAt).toBe("2026-08-30T05:00:00Z");
  });

  it("keeps the area so the arbiter can weight it", () => {
    const [c] = promotionCandidates([row({ area: "faith" })], NOW);
    expect(c.area).toBe("faith");
  });

  it("carries the promotion id as the commitment id, for the session binding", () => {
    const [c] = promotionCandidates([row({ id: "promo-7" })], NOW);
    expect(c.commitmentId).toBe("promo-7");
    expect(c.commitmentKind).toBe("promotion");
  });

  it("an empty set is an empty list, not a placeholder candidate", () => {
    expect(promotionCandidates([], NOW)).toEqual([]);
  });
});
