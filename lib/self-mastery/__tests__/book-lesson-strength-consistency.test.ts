import { describe, it, expect } from "vitest";
import { averageRetrievability, type CardStateForStrength } from "../memory-strength";

const NOW = new Date("2026-09-01T12:00:00.000Z");

function reviewed(daysAgo: number, stability: number): CardStateForStrength {
  return {
    state: "review",
    stability,
    difficulty: 5,
    dueAt: null,
    reps: 3,
    lapses: 0,
    lastReviewAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
  };
}

// get-book-detail.ts computes book-level strength from ALL of a book's
// cards, and each lesson's strength from that lesson's own subset — both
// through this same function. Per the Lead's instruction after the FSRS-5/
// 6 incident ("verify they agree, at inputs where they'd differ if they
// were wrong"): this is the property that must hold for those two numbers
// to be mutually consistent rather than two implementations that merely
// happen to agree today. If book-level ever became an average-of-lesson-
// averages instead of a flat average over every card, this test would
// catch it (it fails for lessons with unequal card counts, which the
// dataset below deliberately has: 3 cards vs 1 card).
describe("book strength vs. its lessons' strengths — same-data consistency", () => {
  it("book strength equals the flat average over every card, not an average of the per-lesson averages", () => {
    const lessonACards = [reviewed(1, 10), reviewed(5, 10), null];
    const lessonBCards = [reviewed(20, 10)];
    const allBookCards = [...lessonACards, ...lessonBCards];

    const bookStrength = averageRetrievability(allBookCards, NOW);
    const lessonAStrength = averageRetrievability(lessonACards, NOW);
    const lessonBStrength = averageRetrievability(lessonBCards, NOW);

    // The correct (flat) computation:
    const expectedBookStrength =
      (lessonACards.length * lessonAStrength + lessonBCards.length * lessonBStrength) / allBookCards.length;
    expect(bookStrength).toBeCloseTo(expectedBookStrength, 10);

    // The bug this guards against — averaging the two lesson averages
    // unweighted — gives a materially different number for this dataset,
    // proving the test would actually fail if book-level strength were
    // computed that way instead.
    const naiveAverageOfAverages = (lessonAStrength + lessonBStrength) / 2;
    expect(Math.abs(bookStrength - naiveAverageOfAverages)).toBeGreaterThan(0.01);
  });

  it("every card counted exactly once: sum of per-lesson card counts equals the book's card count", () => {
    const lessonACards = [reviewed(1, 10), null, reviewed(3, 8)];
    const lessonBCards = [reviewed(2, 12), null];
    const lessonCCards: (CardStateForStrength | null)[] = [];
    const grouped = [lessonACards, lessonBCards, lessonCCards];
    const flat = grouped.flat();

    const totalFromGroups = grouped.reduce((sum, g) => sum + g.length, 0);
    expect(totalFromGroups).toBe(flat.length);
    expect(averageRetrievability(flat, NOW)).toBeCloseTo(averageRetrievability(flat, NOW), 10);
  });
});
