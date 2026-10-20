import { clampWpm } from "./rsvp";

export interface SpeedTestResult {
  /** Words per minute from the timer (clamped to the reader's range). */
  wpm: number;
  correct: number;
  total: number;
  /** 0-100. */
  comprehensionPct: number;
  /** Speed x comprehension: what you actually took in per minute. */
  effectiveWpm: number;
  /** Suggested reader speed: the measured speed when comprehension held up, 25% slower when it did not. */
  recommendedWpm: number;
  /** True when the timing is believable (>= 5 s). Anything shorter means "Done" was pressed without reading. */
  valid: boolean;
}

/** Below this share of correct answers the suggested speed is reduced. */
export const COMPREHENSION_OK = 2 / 3;
export const MIN_VALID_MS = 5000;

export function scoreSpeedTest(input: { wordCount: number; elapsedMs: number; answers: (number | null)[]; correctAnswers: number[] }): SpeedTestResult {
  const total = input.correctAnswers.length;
  const correct = input.correctAnswers.reduce((n, a, i) => n + (input.answers[i] === a ? 1 : 0), 0);
  const share = total === 0 ? 0 : correct / total;
  const valid = Number.isFinite(input.elapsedMs) && input.elapsedMs >= MIN_VALID_MS && input.wordCount > 0;
  const raw = valid ? (input.wordCount / input.elapsedMs) * 60000 : 0;
  const wpm = clampWpm(raw);
  const roundTo10 = (n: number) => clampWpm(Math.round(n / 10) * 10);
  return {
    wpm,
    correct,
    total,
    comprehensionPct: Math.round(share * 100),
    effectiveWpm: Math.round(wpm * share),
    recommendedWpm: roundTo10(share >= COMPREHENSION_OK - 1e-9 ? wpm : wpm * 0.75),
    valid,
  };
}
