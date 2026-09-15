import { describe, it, expect } from "vitest";
import {
  estimateWorstCaseTranscriptionCostUsd,
  computeActualTranscriptionCostUsd,
  OPENAI_WHISPER_USD_PER_MINUTE,
  GEMINI_AUDIO_TOKENS_PER_SECOND,
} from "../transcription-pricing";
import { MODEL_CATALOG } from "../model-catalog";

describe("computeActualTranscriptionCostUsd", () => {
  it("OpenAI: 10 minutes of audio costs 10x the per-minute rate", () => {
    const cost = computeActualTranscriptionCostUsd("openai", 600);
    expect(cost).toBeCloseTo(10 * OPENAI_WHISPER_USD_PER_MINUTE, 10);
  });

  it("OpenAI: zero duration costs zero", () => {
    expect(computeActualTranscriptionCostUsd("openai", 0)).toBe(0);
  });

  it("Gemini: cost scales with tokens-per-second-of-audio at the budget model's input rate", () => {
    const durationSeconds = 120;
    const cost = computeActualTranscriptionCostUsd("google", durationSeconds);
    const expectedTokens = durationSeconds * GEMINI_AUDIO_TOKENS_PER_SECOND;
    const expected = (expectedTokens / 1_000_000) * MODEL_CATALOG.google.budget.inputUsdPer1M;
    expect(cost).toBeCloseTo(expected, 10);
  });
});

describe("estimateWorstCaseTranscriptionCostUsd", () => {
  it("a larger file always estimates at least as much cost as a smaller one, for the same provider", () => {
    const small = estimateWorstCaseTranscriptionCostUsd("openai", 1_000_000);
    const large = estimateWorstCaseTranscriptionCostUsd("openai", 10_000_000);
    expect(large).toBeGreaterThan(small);
  });

  it("the worst-case estimate for a real file is never less than the actual cost computed from its real duration at a normal (higher) bitrate", () => {
    // A 5-minute recording at a normal 128kbps bitrate is about 4.8MB. The
    // worst-case estimator assumes a much lower (64kbps) bitrate for the
    // SAME file size, which must never under-estimate what a real file of
    // that size could actually cost.
    const durationSeconds = 5 * 60;
    const normalBitrateBps = 128_000;
    const sizeBytes = (durationSeconds * normalBitrateBps) / 8;

    const worstCase = estimateWorstCaseTranscriptionCostUsd("openai", sizeBytes);
    const actual = computeActualTranscriptionCostUsd("openai", durationSeconds);
    expect(worstCase).toBeGreaterThanOrEqual(actual);
  });

  it("zero-byte file estimates zero cost, not NaN or a fabricated minimum", () => {
    expect(estimateWorstCaseTranscriptionCostUsd("openai", 0)).toBe(0);
    expect(estimateWorstCaseTranscriptionCostUsd("google", 0)).toBe(0);
  });
});
