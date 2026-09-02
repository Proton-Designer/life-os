import { describe, it, expect } from "vitest";
import { isGrounded, normalizeForGroundingCheck } from "../grounding";
import type { CandidateLesson } from "../types";

function makeCandidate(provenanceQuote: string): CandidateLesson {
  return {
    title: "t",
    coreClaim: "c",
    mechanism: "m",
    actionTemplate: "a",
    evidenceStrength: "author_anecdote",
    provenanceQuote,
    pageRef: 1,
    sourceChunkId: "chunk-1",
  };
}

/**
 * CLAUDE.md's hard constraint: "Any extracted lesson without a
 * verbatim-matching grounding quote from the source book is dropped before
 * it reaches the database." This is the ONE function that enforces that
 * rule in code (the other enforcement point is the DB's
 * `provenance_quote NOT NULL` constraint, which can't check verbatim-ness at
 * all). A regression here is a hallucination-firewall regression.
 */
describe("isGrounded — the hallucination firewall", () => {
  it("accepts a quote that is an exact substring of the source", () => {
    const source = "The quick brown fox jumps over the lazy dog.";
    expect(isGrounded(makeCandidate("The quick brown fox jumps over the lazy dog."), source)).toBe(true);
  });

  it("accepts a quote that is a substring of a longer source chunk", () => {
    const source = "Before the sentence. The quick brown fox jumps over the lazy dog. After the sentence.";
    expect(isGrounded(makeCandidate("The quick brown fox jumps over the lazy dog."), source)).toBe(true);
  });

  it("rejects a quote not present in the source at all", () => {
    const source = "The quick brown fox jumps over the lazy dog.";
    expect(isGrounded(makeCandidate("The slow red fox walks past the sleeping cat."), source)).toBe(false);
  });

  it("rejects a paraphrase, even a close one — verbatim only, never semantic", () => {
    const source = "Any task under two minutes should be done immediately.";
    expect(isGrounded(makeCandidate("Small tasks should be handled right away."), source)).toBe(false);
  });

  it("rejects an empty quote outright rather than vacuously matching", () => {
    const source = "Any real source text at all.";
    expect(isGrounded(makeCandidate(""), source)).toBe(false);
    expect(isGrounded(makeCandidate("   "), source)).toBe(false);
  });

  it("collapses whitespace on both sides before comparing", () => {
    const source = "The   quick brown\nfox   jumps over the lazy dog.";
    expect(isGrounded(makeCandidate("The quick brown fox jumps over the lazy dog."), source)).toBe(true);
  });

  it("folds smart quotes and dashes to their ASCII equivalents on both sides", () => {
    const source = "She said “this won’t work” — obviously.";
    expect(isGrounded(makeCandidate('She said "this won\'t work" - obviously.'), source)).toBe(true);
  });

  it("does NOT fold case — a quote that only matches by ignoring case is not verbatim", () => {
    const source = "The Quick Brown Fox Jumps Over The Lazy Dog.";
    expect(isGrounded(makeCandidate("the quick brown fox jumps over the lazy dog."), source)).toBe(false);
  });
});

describe("normalizeForGroundingCheck", () => {
  it("preserves case", () => {
    expect(normalizeForGroundingCheck("Hello World")).toBe("Hello World");
  });

  it("collapses internal whitespace runs to single spaces and trims", () => {
    expect(normalizeForGroundingCheck("  Hello   \n  World  ")).toBe("Hello World");
  });
});
