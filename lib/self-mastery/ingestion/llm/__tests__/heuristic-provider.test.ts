import { describe, it, expect, vi } from "vitest";
import { HeuristicProvider } from "../heuristic-provider";
import type { CandidateLesson } from "../types";

function makeCandidate(overrides: Partial<CandidateLesson> = {}): CandidateLesson {
  return {
    title: "Use the two-minute rule",
    coreClaim: "Any task under two minutes should be done immediately.",
    mechanism: "This eliminates deferral friction.",
    actionTemplate: "This week, apply this to one small task.",
    evidenceStrength: "author_anecdote",
    provenanceQuote: "Any task under two minutes should be done immediately.",
    pageRef: 10,
    sourceChunkId: "chunk-1",
    ...overrides,
  };
}

/**
 * R9 item 5 / boss-handoff: `mergeLessons` in ULM's original heuristicProvider.ts
 * called `embed([candidate.coreClaim])` once PER CANDIDATE inside a
 * `Promise.all(candidates.map(...))` — every call a batch of one, so the
 * embedder's own internal batching (e.g. the worker's real embedTexts,
 * BATCH_SIZE=16) never engages. Measured live via merge-bench.mjs: 1.7x on
 * the embed step alone from calling once over the whole array instead.
 * This is a regression test for that fix, not a behavior spec for
 * clusterAndRank (covered separately in merge.test.ts) — it asserts the
 * CALL SHAPE, which is the part a correctness-only test can't see: a
 * function that returns the right embeddings while still calling `embed`
 * once per item would pass every output-shape assertion and still be slow.
 */
describe("HeuristicProvider.mergeLessons — embedder call shape", () => {
  it("calls the injected embedder exactly ONCE with the whole candidate array, never once per candidate", async () => {
    const candidates = [
      makeCandidate({ coreClaim: "Claim one." }),
      makeCandidate({ coreClaim: "Claim two." }),
      makeCandidate({ coreClaim: "Claim three." }),
    ];
    const embed = vi.fn(async (texts: string[]) => texts.map((_, i) => [i, i + 1, i + 2]));
    const provider = new HeuristicProvider(embed);

    await provider.mergeLessons({ candidates, targetCount: { min: 1, max: 3 } });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(["Claim one.", "Claim two.", "Claim three."]);
  });

  it("zips the returned embeddings back onto the SAME candidate they came from, index for index", async () => {
    const candidates = [
      makeCandidate({ coreClaim: "Alpha claim.", title: "Alpha" }),
      makeCandidate({ coreClaim: "Beta claim, a very different topic entirely.", title: "Beta" }),
    ];
    // Two embeddings far enough apart that clusterAndRank keeps them as
    // separate clusters (below the 0.86 similarity threshold), so both
    // representatives survive and we can tell which embedding went where
    // by which candidate comes back.
    const embed = vi.fn(async () => [
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const provider = new HeuristicProvider(embed);

    const result = await provider.mergeLessons({ candidates, targetCount: { min: 1, max: 2 } });

    expect(result.map((c) => c.title).sort()).toEqual(["Alpha", "Beta"]);
  });

  it("never calls the embedder at all when no candidates are given", async () => {
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [0, 0, 0]));
    const provider = new HeuristicProvider(embed);

    const result = await provider.mergeLessons({ candidates: [], targetCount: { min: 1, max: 3 } });

    expect(result).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });

  it("works with no embedder at all (embedding-less clustering, every candidate its own cluster)", async () => {
    const candidates = [makeCandidate(), makeCandidate({ coreClaim: "A different claim." })];
    const provider = new HeuristicProvider(); // no embedder injected

    const result = await provider.mergeLessons({ candidates, targetCount: { min: 1, max: 2 } });

    expect(result).toHaveLength(2);
  });
});

describe("HeuristicProvider.extractLessons", () => {
  it("only returns candidates whose provenance quote verbatim-matches the source chunk", async () => {
    const provider = new HeuristicProvider();
    const chunkText =
      "You should always try to finish what you start. This means avoiding half-completed projects, because they drain your attention even when you're not working on them.";
    const result = await provider.extractLessons({
      chunkText,
      pageStart: 5,
      pageEnd: 5,
      sourceChunkId: "chunk-x",
    });
    for (const candidate of result) {
      expect(chunkText).toContain(candidate.provenanceQuote);
    }
  });
});
