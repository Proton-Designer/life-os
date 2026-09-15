import { describe, expect, it } from "vitest";
import { estimateWorstCaseEmbeddingCostUsd, computeActualEmbeddingCostUsd } from "../embeddings-pricing";

describe("estimateWorstCaseEmbeddingCostUsd", () => {
  it("scales with total input text length across all texts, not just the first", () => {
    const one = estimateWorstCaseEmbeddingCostUsd("openai", ["a".repeat(4000)]);
    const two = estimateWorstCaseEmbeddingCostUsd("openai", ["a".repeat(4000), "a".repeat(4000)]);
    expect(two).toBeCloseTo(one * 2, 10);
  });

  it("openai and google price the same input differently, reflecting their real per-token rates", () => {
    const texts = ["a".repeat(4_000_000)]; // ~1M tokens at 4 chars/token
    const openaiCost = estimateWorstCaseEmbeddingCostUsd("openai", texts);
    const googleCost = estimateWorstCaseEmbeddingCostUsd("google", texts);
    expect(openaiCost).toBeCloseTo(0.02, 5);
    expect(googleCost).toBeCloseTo(0.15, 5);
  });

  it("empty text array costs nothing", () => {
    expect(estimateWorstCaseEmbeddingCostUsd("openai", [])).toBe(0);
  });
});

describe("computeActualEmbeddingCostUsd", () => {
  it("computes real cost directly from reported token count, not from any estimate", () => {
    expect(computeActualEmbeddingCostUsd("openai", 1_000_000)).toBeCloseTo(0.02, 5);
    expect(computeActualEmbeddingCostUsd("google", 1_000_000)).toBeCloseTo(0.15, 5);
  });

  it("zero tokens costs nothing", () => {
    expect(computeActualEmbeddingCostUsd("openai", 0)).toBe(0);
  });
});
