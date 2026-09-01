import { describe, expect, it } from "vitest";
import { repairLessonAdjacency, groupQueueIntoPlan } from "../plan";
import type { SessionCard } from "../types";

function card(id: string, lessonId: string, reason: SessionCard["reason"], promptType: SessionCard["promptType"] = "free_recall"): SessionCard {
  return { id, lessonId, bookId: "book-1", promptType, prompt: `prompt-${id}`, reason, queuePosition: 0 };
}

describe("repairLessonAdjacency", () => {
  it("leaves an already-alternating list untouched", () => {
    const cards = [card("a", "L1", "due"), card("b", "L2", "due"), card("c", "L1", "due")];
    expect(repairLessonAdjacency(cards).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("swaps a same-lesson neighbor forward to break adjacency", () => {
    const cards = [card("a", "L1", "due"), card("b", "L1", "due"), card("c", "L2", "due")];
    const result = repairLessonAdjacency(cards);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.lessonId).not.toBe(result[i - 1]!.lessonId);
    }
  });

  it("never crashes and never drops a card when no safe swap exists (only one lesson remains)", () => {
    const cards = [card("a", "L1", "due"), card("b", "L1", "due"), card("c", "L1", "due")];
    const result = repairLessonAdjacency(cards);
    expect(result.map((c) => c.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("never moves cards inside the pinned prefix (the warm-up slot)", () => {
    const cards = [card("warm", "L1", "warm_up"), card("a", "L1", "due"), card("b", "L2", "due")];
    const result = repairLessonAdjacency(cards, 1);
    expect(result[0]!.id).toBe("warm");
  });
});

describe("groupQueueIntoPlan", () => {
  it("dedupes by id defensively", () => {
    const cards = [card("a", "L1", "due"), card("a", "L1", "due")];
    const plan = groupQueueIntoPlan(cards);
    expect(plan.due.length + plan.warmUp.length + plan.fresh.length + (plan.closer ? 1 : 0)).toBe(1);
  });

  it("splits into warmUp/due/fresh by reason", () => {
    const cards = [card("w", "L1", "warm_up"), card("d", "L2", "due"), card("n", "L3", "new")];
    const plan = groupQueueIntoPlan(cards);
    expect(plan.warmUp.map((c) => c.id)).toEqual(["w"]);
    expect(plan.due.map((c) => c.id)).toEqual(["d"]);
    expect(plan.fresh.map((c) => c.id)).toEqual(["n"]);
  });

  it("pulls the last application-type new card out as the closer, preferring fresh over due", () => {
    const cards = [
      card("d1", "L1", "due", "free_recall"),
      card("d2", "L2", "due", "application"),
      card("n1", "L3", "new", "free_recall"),
      card("n2", "L4", "new", "application"),
    ];
    const plan = groupQueueIntoPlan(cards);
    expect(plan.closer?.id).toBe("n2");
    expect(plan.fresh.map((c) => c.id)).not.toContain("n2");
  });

  it("falls back to a due application card as the closer when fresh has none", () => {
    const cards = [card("d1", "L1", "due", "application"), card("n1", "L2", "new", "free_recall")];
    const plan = groupQueueIntoPlan(cards);
    expect(plan.closer?.id).toBe("d1");
  });

  it("returns null closer rather than fabricating one when nothing in the queue is an application prompt", () => {
    const cards = [card("d1", "L1", "due", "free_recall"), card("n1", "L2", "new", "cloze")];
    const plan = groupQueueIntoPlan(cards);
    expect(plan.closer).toBeNull();
  });
});
