import { describe, it, expect } from "vitest";
import { clusterAndRank, computeTargetLessonCount, computePartialThreshold, type ScoredCandidate } from "../merge";
import type { CandidateLesson } from "../llm/types";

function makeCandidate(overrides: Partial<CandidateLesson> = {}): CandidateLesson {
  return {
    title: "A title",
    coreClaim: "A claim.",
    mechanism: "Because reasons.",
    actionTemplate: "Do the thing.",
    evidenceStrength: "author_anecdote",
    provenanceQuote: "A claim.",
    pageRef: 1,
    sourceChunkId: "chunk-1",
    ...overrides,
  };
}

function scored(embedding: number[], overrides: Partial<CandidateLesson> = {}): ScoredCandidate {
  return { candidate: makeCandidate(overrides), embedding };
}

describe("clusterAndRank", () => {
  it("returns an empty array for no items", () => {
    expect(clusterAndRank([], 5)).toEqual([]);
  });

  it("collapses near-identical embeddings (>= 0.86 cosine) into one representative", () => {
    const items = [
      scored([1, 0, 0], { title: "First" }),
      scored([0.99, 0.05, 0], { title: "Near duplicate" }),
    ];
    const result = clusterAndRank(items, 5);
    expect(result).toHaveLength(1);
  });

  it("keeps genuinely different embeddings as separate lessons", () => {
    const items = [
      scored([1, 0, 0], { title: "Topic A" }),
      scored([0, 1, 0], { title: "Topic B" }),
      scored([0, 0, 1], { title: "Topic C" }),
    ];
    const result = clusterAndRank(items, 5);
    expect(result).toHaveLength(3);
  });

  it("within a cluster, prefers stronger evidence as the tie-break representative", () => {
    const items = [
      scored([1, 0, 0], { title: "Weak", evidenceStrength: "author_anecdote" }),
      scored([1, 0, 0], { title: "Strong", evidenceStrength: "strong_research" }),
    ];
    const result = clusterAndRank(items, 5);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Strong");
  });

  it("truncates to n when more clusters survive than the target count allows", () => {
    const items = Array.from({ length: 10 }, (_, i) => {
      // Ten orthogonal-ish directions -> ten distinct clusters, spread across pages.
      const v = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      v[i] = 1;
      return scored(v, { title: `Lesson ${i}`, pageRef: i * 10 });
    });
    const result = clusterAndRank(items, 4);
    expect(result).toHaveLength(4);
  });

  it("never invents extra lessons to pad below n — a book with fewer real clusters stays short", () => {
    const items = [scored([1, 0, 0]), scored([0, 1, 0])];
    const result = clusterAndRank(items, 10);
    expect(result).toHaveLength(2);
  });
});

describe("computeTargetLessonCount", () => {
  it("floors at 6 for a short book", () => {
    expect(computeTargetLessonCount(10)).toBe(6);
  });

  it("caps at 60 for a very long book", () => {
    expect(computeTargetLessonCount(1000)).toBe(60);
  });

  it("scales roughly one lesson per 8 pages in between", () => {
    expect(computeTargetLessonCount(160)).toBe(20);
  });
});

describe("computePartialThreshold", () => {
  it("floors at 3 even for a tiny target count", () => {
    expect(computePartialThreshold(2)).toBe(3);
  });

  it("caps at the default ceiling of 10 for a large target count", () => {
    expect(computePartialThreshold(60)).toBe(10);
  });

  it("is half of targetCount in the middle of the range", () => {
    expect(computePartialThreshold(12)).toBe(6);
  });
});
