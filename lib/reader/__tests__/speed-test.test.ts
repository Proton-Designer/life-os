import { describe, expect, it } from "vitest";
import { scoreSpeedTest } from "../speed-test";
import { SPEED_TEST_PARAGRAPHS, SPEED_TEST_QUESTIONS, SPEED_TEST_WORDS } from "../speed-test-passage";
import { MAX_WPM, MIN_WPM } from "../rsvp";

const correctAnswers = SPEED_TEST_QUESTIONS.map((q) => q.answer);
const base = { wordCount: 300, correctAnswers: [1, 2, 1] };

describe("scoreSpeedTest", () => {
  it("300 words in 60 s is 300 wpm; all correct keeps the recommendation", () => {
    const r = scoreSpeedTest({ ...base, elapsedMs: 60000, answers: [1, 2, 1] });
    expect(r).toMatchObject({ wpm: 300, correct: 3, total: 3, comprehensionPct: 100, effectiveWpm: 300, recommendedWpm: 300, valid: true });
  });
  it("2 of 3 right is still fine; 1 of 3 cuts the suggestion by a quarter (rounded to 10)", () => {
    expect(scoreSpeedTest({ ...base, elapsedMs: 60000, answers: [1, 2, 0] })).toMatchObject({ correct: 2, comprehensionPct: 67, recommendedWpm: 300, effectiveWpm: 200 });
    expect(scoreSpeedTest({ ...base, elapsedMs: 60000, answers: [1, 0, 0] })).toMatchObject({ correct: 1, comprehensionPct: 33, recommendedWpm: 230 });
  });
  it("skipped answers (null) count as wrong", () => {
    expect(scoreSpeedTest({ ...base, elapsedMs: 60000, answers: [null, null, null] }).correct).toBe(0);
  });
  it("a too-short run is invalid (pressed Done without reading) and never recommends a huge speed", () => {
    const r = scoreSpeedTest({ ...base, elapsedMs: 800, answers: [1, 2, 1] });
    expect(r.valid).toBe(false);
    expect(r.recommendedWpm).toBeLessThanOrEqual(MAX_WPM);
    expect(r.wpm).toBe(MIN_WPM);
  });
  it("the result is clamped to the reader's range", () => {
    expect(scoreSpeedTest({ ...base, elapsedMs: 6000, answers: [1, 2, 1] }).wpm).toBe(MAX_WPM); // 3000 raw
    expect(scoreSpeedTest({ ...base, elapsedMs: 600000, answers: [1, 2, 1] }).wpm).toBe(MIN_WPM); // 30 raw
  });
  it("NaN/Infinity timing is invalid, not a crash", () => {
    expect(scoreSpeedTest({ ...base, elapsedMs: NaN, answers: [] }).valid).toBe(false);
  });
});

describe("the built-in passage", () => {
  it("is about 300 words, with 3 well-formed questions", () => {
    expect(SPEED_TEST_WORDS).toBeGreaterThan(250);
    expect(SPEED_TEST_WORDS).toBeLessThan(350);
    expect(SPEED_TEST_PARAGRAPHS.length).toBeGreaterThan(2);
    expect(SPEED_TEST_QUESTIONS).toHaveLength(3);
    for (const q of SPEED_TEST_QUESTIONS) {
      expect(q.options.length).toBeGreaterThanOrEqual(3);
      expect(q.answer).toBeGreaterThanOrEqual(0);
      expect(q.answer).toBeLessThan(q.options.length);
    }
    expect(correctAnswers).toEqual([1, 2, 1]);
  });
});
