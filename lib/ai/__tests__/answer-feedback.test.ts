import { describe, expect, it } from "vitest";
import { parseFeedbackForTest } from "@/app/(app)/personal/answer-feedback-actions";

describe("parsing model feedback", () => {
  it("extracts the rating and strips it from the prose", async () => {
    const r = await parseFeedbackForTest("You got the core idea but missed the second clause.\nRATING: 3");
    expect(r.suggestedRating).toBe(3);
    expect(r.feedback).not.toMatch(/RATING/);
    expect(r.feedback).toMatch(/second clause/);
  });

  it("returns NO rating when the model ignores the format", async () => {
    // Deliberate: an invented rating would feed a real FSRS grade and corrupt
    // the user's schedule. Feedback without a suggestion is strictly better
    // than a confident wrong number.
    const r = await parseFeedbackForTest("That's roughly right.");
    expect(r.suggestedRating).toBeNull();
    expect(r.feedback).toBe("That's roughly right.");
  });

  it("ignores an out-of-range rating rather than clamping it", async () => {
    const r = await parseFeedbackForTest("Nope.\nRATING: 9");
    expect(r.suggestedRating).toBeNull();
  });

  it("never returns empty feedback", async () => {
    const r = await parseFeedbackForTest("RATING: 4");
    expect(r.feedback.length).toBeGreaterThan(0);
  });
});
