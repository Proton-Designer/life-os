import type { CandidateLesson, GeneratedCard, PromptType } from "./llm/types";
import { normalizeForGroundingCheck } from "./llm/grounding";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "with", "by", "from", "as", "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those", "it", "its", "you", "your", "we", "our",
  "they", "their", "he", "she", "his", "her", "not", "no", "do", "does", "did",
  "can", "could", "will", "would", "should", "may", "might", "must", "have",
  "has", "had", "if", "then", "than", "so", "because", "which", "who", "what",
  "when", "where", "why", "how", "there", "here", "all", "any", "one", "into",
]);

function contentWords(text: string): Set<string> {
  const words = text.match(/[A-Za-z][A-Za-z'-]{2,}/g) ?? [];
  return new Set(words.map((w) => w.toLowerCase()).filter((w) => !STOPWORDS.has(w)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Tightened 0.35 -> 0.28: "What is the main idea ... through controlling and
// shaping your thoughts?" scored under 0.35 but still handed over most of
// the answer's content words.
const ANTI_LEAK_JACCARD_THRESHOLD = 0.28;

/**
 * Write-time gate #1, applies to every provider's output: a card whose
 * prompt contains most of its answer's content words defeats retrieval
 * practice — the product's entire thesis. "A card that leaks its answer
 * must never reach the database."
 */
export function passesAntiLeak(card: GeneratedCard): { passed: boolean; overlap: number } {
  const overlap = jaccard(contentWords(card.prompt), contentWords(card.answer));
  return { passed: overlap < ANTI_LEAK_JACCARD_THRESHOLD, overlap };
}

// Calibrated against 4 real prompt/claim pairs — a vague prompt ("What is
// the main idea of the lesson?") scored 0.300, two genuinely good
// topic-anchored prompts scored 0.524 and 0.684. 0.40 sits cleanly between them.
const TOPICALITY_COSINE_FLOOR = 0.4;

/**
 * Write-time gate #6 — the companion to anti-leak, not a replacement:
 * sessions are interleaved across books/sources — a user sees this card
 * cold, with no idea which lesson is being asked about. Anti-leak alone
 * over-corrects to prompts so vague they're unanswerable ("What is the main
 * idea of the lesson?" passes anti-leak trivially but fails this). The
 * requirement is a BAND: topically anchored (this gate, must be above the
 * floor) AND lexically distinct (anti-leak, must be below its ceiling) —
 * both required, checked independently.
 */
export function passesTopicality(
  promptEmbedding: number[],
  claimEmbedding: number[],
): { passed: boolean; similarity: number } {
  const similarity = cosineSimilarity(promptEmbedding, claimEmbedding);
  return { passed: similarity >= TOPICALITY_COSINE_FLOOR, similarity };
}

// Calibrated against a real near-copy the substring check missed: quote's
// two sentences merged into one participial clause scored 0.846 Jaccard
// content-word overlap. A genuine paraphrase pair scored 0.063. 0.5 sits
// far from both.
const CLAIM_QUOTE_JACCARD_CEILING = 0.5;

/**
 * Write-time gate #2. `core_claim` must not be (near-)identical to
 * `provenance_quote` — forces transformation rather than a copy. A pure
 * selection heuristic without generation capability will generally fail
 * this by construction; that's the correct, honest outcome, not a bug in
 * the gate.
 *
 * The substring check alone missed a real case: two sentences from the
 * quote merged into one participial clause is not a substring match, but
 * it's exactly the "quote with words swapped" shape the extraction prompt
 * already warns against. Jaccard overlap (same machinery as anti-leak)
 * catches near-copies the substring check can't.
 */
export function passesClaimNotQuote(candidate: CandidateLesson): boolean {
  const claim = normalizeForGroundingCheck(candidate.coreClaim);
  const quote = normalizeForGroundingCheck(candidate.provenanceQuote);
  if (claim.length === 0) return false;
  if (claim === quote || claim.includes(quote) || quote.includes(claim)) return false;
  const overlap = jaccard(contentWords(candidate.coreClaim), contentWords(candidate.provenanceQuote));
  return overlap < CLAIM_QUOTE_JACCARD_CEILING;
}

const MECHANISM_RELEVANCE_COSINE_FLOOR = 0.25;

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Write-time gate #3. Embeddings are cheap (already computed for merge
 * clustering) — this catches a mechanism that's topically unrelated to its
 * claim (e.g. a health claim paired with a mechanism about an employer
 * underpaying workers, from blindly taking "the next N sentences"
 * regardless of topical continuity).
 */
export function passesMechanismRelevance(
  claimEmbedding: number[],
  mechanismEmbedding: number[],
): { passed: boolean; similarity: number } {
  const similarity = cosineSimilarity(claimEmbedding, mechanismEmbedding);
  return { passed: similarity >= MECHANISM_RELEVANCE_COSINE_FLOOR, similarity };
}

// CALIBRATED against measured cosine similarity across a real review deck.
// Scores ranged 0.180-0.740. The severe case (a "two-minute rule" claim
// grounded in an unrelated social-comparison quote) scored 0.180, an
// isolated outlier with a real gap to the next-lowest score (0.337). 0.30
// sits in that gap.
//
// IMPORTANT LIMITATION, found by manually reading the mid-range scores, not
// assumed: a second bad case (a multitasking claim grounded in a quote about
// environmental distractions) scored 0.366 — inside the range of several
// manually-verified GOOD lessons (0.337-0.433, legitimate abstract/
// philosophical paraphrases). Cosine similarity alone cannot reliably
// separate "related topic, wrong specific claim" from "different phrasing,
// same specific claim" — raising the floor to catch the second case would
// also drop lessons confirmed good by manual read. That failure mode needs
// a prompt-level fix (require the model to quote the sentence it actually
// derived the claim from), not a statistical threshold — see
// ollama-provider.ts's extraction prompt.
let CLAIM_PROVENANCE_RELEVANCE_FLOOR = 0.3;

/** Test-only override so calibration/tests don't depend on the module-level constant. */
export function _setClaimProvenanceRelevanceFloorForTesting(floor: number): void {
  CLAIM_PROVENANCE_RELEVANCE_FLOOR = floor;
}

/**
 * Write-time gate #5 — the CRITICAL fix: `isGrounded` (verbatim substring
 * match) only proves a quote came from the source text, never that it
 * supports the specific claim it's attached to. A verbatim-but-unrelated
 * quote sails through the hallucination firewall looking identical, in an
 * audit log, to a genuinely grounded one — "N/N provenance passed" measured
 * string-matching, not grounding. This is semantic relevance between the
 * claim and its OWN quote, layered on top of (never instead of) the
 * verbatim check.
 */
export function passesClaimProvenanceRelevance(
  claimEmbedding: number[],
  quoteEmbedding: number[],
): { passed: boolean; similarity: number } {
  const similarity = cosineSimilarity(claimEmbedding, quoteEmbedding);
  return { passed: similarity >= CLAIM_PROVENANCE_RELEVANCE_FLOOR, similarity };
}

// Matches CJK, Hangul, and other non-Latin scripts a generative model can
// stray into mid-response (observed live in ULM: qwen2.5:7b code-switched
// into Chinese mid-sentence in one lesson out of 14 during a real Ollama
// run — rare but real, and looks broken to an end user).
const NON_LATIN_SCRIPT = /[一-鿿぀-ヿ가-힯]/;

/**
 * Write-time gate #4. Provider-agnostic in principle, but only generative
 * providers can actually fail it — the source text feeding HeuristicProvider
 * is already English, so it structurally can't produce this defect.
 */
export function passesLanguageSanity(text: string): boolean {
  return !NON_LATIN_SCRIPT.test(text);
}

// "How would you use self-control as outlined in application answer:" —
// leaked prompt scaffolding reaching the DB verbatim. A user would see that
// literal text.
const TEMPLATE_ARTIFACT_PATTERNS = [
  /\bapplication[_\s]answer\b/i,
  /\bcore[_\s]claim\b/i,
  /\bfree[_\s]recall[_\s]prompt\b/i,
  /\bwhy[_\s]prompt\b/i,
  /\bas outlined in\b/i,
  /\baccording to the (json|schema|format)\b/i,
];
const QUESTION_START = /^(what|why|how|who|when|where|which|do|does|did|can|could|would|should|is|are|will)\b/i;

/**
 * Write-time gate #8 — card text must read as finished, human-facing prose,
 * not machine scaffolding. Three checks: no leaked template/field-name
 * artifacts; a prompt phrased as a question ends with "?" (not truncated
 * mid-clause); every prompt ends in real punctuation, never a bare trailing
 * colon (the exact shape of the leak that motivated this gate).
 *
 * A `cloze` prompt is a declarative sentence with a blank — it is
 * structurally never a question, so "a prompt phrased as a question must
 * end in '?'" is category-inapplicable to cloze, not merely inconvenient.
 * Caught live in ULM: a cloze built from a claim beginning "When something
 * upsetting happens, ..." was rejected outright because QUESTION_START
 * matched "When" and the sentence (correctly) has no "?". The hazard
 * QUESTION_START actually guards against — a truncated or garbled question
 * reaching the DB — cannot occur in a cloze; the garbled cloze that
 * originally motivated this whole gate (below) was caught by
 * SPACED_SLASH_ARTIFACT, which still applies to every prompt type including
 * cloze.
 *
 * This is deliberately fail-closed, not a blanket relaxation: `promptType`
 * is optional and its ABSENCE keeps the strict behaviour. Only an EXPLICIT
 * `"cloze"` skips the QUESTION_START check; every other check still applies
 * to cloze, and QUESTION_START still applies to every other type. A caller
 * that forgets to pass the type gets the safe (strict) answer, never the
 * permissive one.
 */
// "What does this lesson say about conclusions / detrimental?" reached the
// DB in ULM — a garbled cloze where two unresolved candidate fillers landed
// side by side instead of one. It passed every check above (no leaked
// scaffolding, ends with "?", starts with a question word) because none of
// them look at word-level coherence. A space-slash-space is the tell:
// legitimate English slash idioms ("and/or", "he/she", "km/h") are written
// with no surrounding spaces; " / " with spaces on both sides is what an
// unresolved candidate-list/cloze artifact looks like once serialized to
// text, not natural prose.
const SPACED_SLASH_ARTIFACT = /\s\/\s/;

export function passesCardTextSanity(text: string, promptType?: PromptType): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (TEMPLATE_ARTIFACT_PATTERNS.some((p) => p.test(trimmed))) return false;
  if (/:\s*$/.test(trimmed)) return false; // trailing colon = truncated/leaked scaffolding
  if (SPACED_SLASH_ARTIFACT.test(trimmed)) return false;
  // Cloze is structurally never a question — see the docstring above. Every
  // other prompt type (including an unspecified one) keeps the strict check.
  if (promptType !== "cloze" && QUESTION_START.test(trimmed) && !trimmed.endsWith("?")) return false;
  if (!/[.?!]$/.test(trimmed)) return false;
  return true;
}

// Reuses the mechanism-relevance floor — same shape of problem (a title
// like "Act according to your desired outcome" on a claim that's actually
// about thinking, not acting), same tolerance for legitimate abstraction.
const TITLE_CLAIM_RELEVANCE_COSINE_FLOOR = 0.25;

/** Write-time gate #7 — title must not drift to a different topic than its own claim. */
export function passesTitleClaimRelevance(
  titleEmbedding: number[],
  claimEmbedding: number[],
): { passed: boolean; similarity: number } {
  const similarity = cosineSimilarity(titleEmbedding, claimEmbedding);
  return { passed: similarity >= TITLE_CLAIM_RELEVANCE_COSINE_FLOOR, similarity };
}

export interface InvariantCounters {
  antiLeakDropped: number;
  claimEqualsQuoteDropped: number;
  mechanismIrrelevantFlagged: number;
  languageSanityDropped: number;
  claimProvenanceIrrelevantDropped: number;
  titleClaimIrrelevantDropped: number;
  topicalityFailedDropped: number;
  cardTextSanityDropped: number;
  /** A surviving (post-merge) lesson whose quote doesn't SUPPORT its claim per the LLM entailment check. */
  entailmentFailedDropped: number;
  /** Next-ranked archived candidates promoted to fill an entailment-failed slot, bounded to 2 per book. */
  entailmentBackfillAttempted: number;
  entailmentBackfillSucceeded: number;
  /**
   * ULM D-018 finding: a lesson whose every candidate card was individually
   * dropped by `passesCardTextSanity`/`passesAntiLeak` must NOT reach
   * `status: 'active'` — the worker decides promotion AFTER card
   * generation, per-lesson, and denies it when the surviving card count is
   * zero (see promotion.ts's `decidePromotions`, ported alongside this
   * file). Left at its pre-promotion status rather than deleted, so it
   * stays queryable for diagnosis rather than silently vanishing.
   *
   * Why this matters beyond "one lesson is unreachable": before the fix, a
   * card-less lesson could reach `active` and inflate `lesson_count` (a raw
   * per-status count with no connection to whether a lesson has cards)
   * while a book's memory-strength surface silently EXCLUDED it from its
   * average rather than counting it as a zero — a lesson with no cards
   * contributes zero *terms*, not one low term. A book could read near-100%
   * strength while several of the lessons in its own `lesson_count` were
   * never learnable at all. (On the merged platform, memory strength is
   * TypeScript-only — `lib/self-mastery/memory-strength.ts` — but this
   * invariant matters independently of which layer computes strength: a
   * zero-card lesson must not count as a learnable unit anywhere.)
   *
   * This counts survivors DENIED promotion for that reason, computed once
   * post-promotion-decision by cross-referencing merge/entailment survivors
   * against the per-lesson card count — it cannot be incremented eagerly
   * like the others because a lesson's fate isn't known until after both
   * merge/entailment AND card generation.
   */
  zeroCardLessonsDeniedPromotion: number;
}

export function newInvariantCounters(): InvariantCounters {
  return {
    antiLeakDropped: 0,
    claimEqualsQuoteDropped: 0,
    mechanismIrrelevantFlagged: 0,
    cardTextSanityDropped: 0,
    languageSanityDropped: 0,
    claimProvenanceIrrelevantDropped: 0,
    titleClaimIrrelevantDropped: 0,
    topicalityFailedDropped: 0,
    entailmentFailedDropped: 0,
    entailmentBackfillAttempted: 0,
    entailmentBackfillSucceeded: 0,
    zeroCardLessonsDeniedPromotion: 0,
  };
}
