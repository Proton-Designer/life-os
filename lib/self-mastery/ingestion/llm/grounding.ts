/**
 * Leaf module — imports nothing but types from ./types, and nothing in this
 * ingestion port imports it through ./index (the barrel). ULM's own history
 * is why: their `llm/index.ts` used to export `isGrounded`/
 * `normalizeForGroundingCheck` directly while also re-exporting the
 * providers that import them, which is a real require cycle
 * (llm/index.js <-> heuristicProvider.js/ollamaProvider.js <->
 * ingestion/index.js). Node's CJS resolution tolerated it; Metro/bundler
 * resolution surfaced it as latent undefined-at-import-time risk. Fixed
 * there by hoisting these two functions to a leaf file everything imports
 * directly — kept as a leaf file here for the same reason, not because the
 * cycle has been proven to exist in this repo's bundler too.
 */
import type { CandidateLesson } from "./types";

/**
 * "Exact normalised substring match (whitespace collapsed, smart quotes/
 * dashes folded, case preserved)". Case is deliberately NOT folded — a
 * quote that only matches by ignoring case isn't really verbatim.
 */
export function normalizeForGroundingCheck(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Provider-independent hallucination firewall (CLAUDE.md's hard constraint:
 * "any extracted lesson without a verbatim-matching grounding quote from the
 * source book is dropped before it reaches the database"): a lesson whose
 * provenance quote does not verbatim-match the source chunk must never reach
 * the database, regardless of which LlmProvider produced it. This is one of
 * two independent enforcement points on the merged platform — the other is
 * `lessons.provenance_quote NOT NULL CHECK(length(btrim(...))>0)`
 * (tracking-app migration `064_ulm_lessons.sql`).
 */
export function isGrounded(candidate: CandidateLesson, sourceChunkText: string): boolean {
  const normalizedQuote = normalizeForGroundingCheck(candidate.provenanceQuote);
  if (normalizedQuote.length === 0) return false;
  return normalizeForGroundingCheck(sourceChunkText).includes(normalizedQuote);
}
