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

/**
 * L9/R6: the deterministic, keyless stand-in `summarize-sections.ts`'s
 * orchestration is proven against, since no DeepSeek key exists on any
 * account today (no user_api_keys rows, per the lead's own note). Not a
 * claim of summary QUALITY — see the method's own header comment — only
 * that it behaves the way a real summarizer's output shape must: derived
 * from the given text, bounded, never empty when given real input.
 */
describe("HeuristicProvider.summarizeSection", () => {
  it("returns a non-empty summary derived from the chunk texts, capped well under a full section's length", async () => {
    const provider = new HeuristicProvider();
    const chunkTexts = [
      "The two-minute rule states that any task taking less than two minutes should be done immediately, without being added to a list. This avoids the overhead of tracking trivial tasks.",
      "Habit stacking works by anchoring a new habit to an existing, well-established one, borrowing its existing cue rather than needing a brand-new one.",
    ];
    const result = await provider.summarizeSection({ bookTitle: "Atomic Habits", sectionTitle: "Chapter 1", chunkTexts });
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary.length).toBeLessThanOrEqual(410); // the 400-char cap, plus a little slack for the sentence that pushed it over before the break check
  });

  it("is deterministic — the same input always produces the same output (no randomness, no external call)", async () => {
    const provider = new HeuristicProvider();
    const input = { bookTitle: "B", sectionTitle: "S", chunkTexts: ["First sentence here. Second sentence follows."] };
    const a = await provider.summarizeSection(input);
    const b = await provider.summarizeSection(input);
    expect(a.summary).toBe(b.summary);
  });

  it("falls back to a raw character cut when the combined text has no sentence boundary at all", async () => {
    const provider = new HeuristicProvider();
    const noPunctuation = "word ".repeat(200).trim(); // long, real words, but never a sentence terminator
    const result = await provider.summarizeSection({ bookTitle: "B", sectionTitle: "S", chunkTexts: [noPunctuation] });
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary.length).toBeLessThanOrEqual(400);
  });

  it("joins multiple chunks before summarizing, not just the first one", async () => {
    const provider = new HeuristicProvider();
    const onlyFirst = await provider.summarizeSection({ bookTitle: "B", sectionTitle: "S", chunkTexts: ["Short opening."] });
    const withMore = await provider.summarizeSection({
      bookTitle: "B",
      sectionTitle: "S",
      chunkTexts: ["Short opening.", "A second chunk with a genuinely different sentence that was not in the first."],
    });
    expect(withMore.summary).not.toBe(onlyFirst.summary);
  });
});
