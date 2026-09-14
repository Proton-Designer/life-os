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

  it("collapses two empty-embedding candidates with the same normalized title -- the no-embedder dedup gap real book 9094481c-1109-4cfb-a46f-b63c7706d2c1 actually hit (ranks 43/52, both titled \"Reward what you truly value\", p108 and p114): cosine on two [] embeddings is always 0 (< 0.86), so without a lexical fallback these survive as two lessons", () => {
    const items = [
      scored([], {
        title: "Reward what you truly value",
        coreClaim:
          "The point values you assign communicate what your system actually cares about, so if you give large rewards for self-serving marketing actions and tiny rewards for genuine community contributions, users will see the game as shallow and not worth playing.",
        pageRef: 108,
      }),
      scored([], {
        title: "Reward what you truly value",
        coreClaim:
          "If you hand out points for trivial actions or for things that mainly benefit you, users will see the game as shallow and not worth playing.",
        pageRef: 114,
      }),
    ];
    const result = clusterAndRank(items, 5);
    expect(result).toHaveLength(1);
  });

  it("does NOT collapse empty-embedding candidates that merely share a topic under different titles -- same book's actual ranks 11/21/33/44 (all about Octalysis Core Drives, four genuinely distinct claims) must survive as four lessons, not be lexically over-merged", () => {
    const items = [
      scored([], {
        title: "Audit products against all eight Core Drives",
        coreClaim:
          "When evaluating a product or experience for motivational strength, examine how it activates each of the eight Core Drives and list the specific game mechanics and techniques it uses for each one.",
        pageRef: 40,
      }),
      scored([], {
        title: "Check for at least one Core Drive before expecting action",
        coreClaim:
          "When a desired action has no Core Drive backing it, people will lack the motivation to perform it, so the behavior will not occur.",
        pageRef: 31,
      }),
      scored([], {
        title: "Focus on core drives, not surface mechanics",
        coreClaim:
          "Designers should prioritize the fundamental motivational drives rather than getting attached to specific game mechanics or techniques, because those are merely superficial details.",
        pageRef: 81,
      }),
      scored([], {
        title: "Make things scarce to boost motivation",
        coreClaim:
          "Increasing the difficulty or limiting availability of a desired action can heighten anticipation and drive more of that behavior, even though the action itself becomes harder to perform.",
        pageRef: 382,
      }),
    ];
    const result = clusterAndRank(items, 5);
    expect(result).toHaveLength(4);
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
    // Distinct titles, not just distinct embeddings -- two candidates that
    // share `makeCandidate`'s default title would now also collide on the
    // exact-title fallback added for the no-embedder path, which is not
    // what this test is exercising.
    const items = [scored([1, 0, 0], { title: "Topic A" }), scored([0, 1, 0], { title: "Topic B" })];
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
