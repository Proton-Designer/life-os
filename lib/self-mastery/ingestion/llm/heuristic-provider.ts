import type {
  ChunkTriageInput,
  ChunkTriageResult,
  ExtractLessonsInput,
  CandidateLesson,
  MergeLessonsInput,
  GenerateCardsInput,
  GeneratedCard,
  GradeAnswerInput,
  GradeAnswerResult,
  EntailmentCheckInput,
  EntailmentCheckResult,
  LlmProvider,
} from "./types";
import { isGrounded } from "./grounding";
import { splitIntoSentences } from "../sentences";
import { clusterAndRank, type ScoredCandidate } from "../merge";
import { generateCardsForLesson } from "../cards";
import { classifyEvidenceStrength } from "../evidence-strength";

/** Injected so this module stays free of a heavy runtime dependency — the
 * worker supplies the real transformers.js embedder; tests can supply a fake. */
export type Embedder = (texts: string[]) => Promise<number[][]>;

const IMPERATIVE_CUE =
  /^(use|try|start|avoid|stop|ask|practice|apply|remember|focus|choose|write|track|set|make|take|build|create|treat|question|reframe|schedule|plan|identify|notice)\b/i;
const CAUSAL_CUE =
  /\b(because|which means|the key is|this means|as a result|therefore|so that|the reason|leads to|the point is)\b/i;
const YOU_SHOULD_CUE = /\byou (should|must|can|need to|have to)\b/i;

function scoreSentence(sentence: string, index: number, total: number): number {
  let score = 0;
  if (IMPERATIVE_CUE.test(sentence)) score += 3;
  if (YOU_SHOULD_CUE.test(sentence)) score += 2;
  if (CAUSAL_CUE.test(sentence)) score += 2;
  // Topic sentences cluster early in a passage — mild bonus for the first half.
  const positionRatio = index / Math.max(total - 1, 1);
  if (positionRatio < 0.5) score += 1;
  // Penalize likely fragments (too short) or run-ons (too long).
  const len = sentence.length;
  if (len < 40 || len > 400) score -= 2;
  return score;
}

function cosineSimilarity(a: number[], b: number[]): number {
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

function meanVector(vectors: number[][]): number[] {
  const first = vectors[0];
  if (!first) return [];
  const dims = first.length;
  const mean = new Array(dims).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dims; i++) mean[i] += (v[i] ?? 0) / vectors.length;
  }
  return mean;
}

// Second-person imperative claims ("You should...", "Avoid...") are the easy
// case. Real prose — especially older or philosophical non-fiction — is
// often third-person declarative ("Man is...", "Circumstance does not..."),
// which none of these match on verb alone. The later third-person patterns
// exist because an earlier version of this bank fell through to the single
// generic fallback for nearly every lesson in a real end-to-end test — a
// real quality bug, not a hypothetical one.
const ACTION_TEMPLATES: { pattern: RegExp; build: () => string }[] = [
  { pattern: /^(avoid|stop|don't|do not)\b/i, build: () => "This week, notice one moment where you'd normally do this — and don't." },
  { pattern: /^(use|try|apply)\b/i, build: () => "This week, use this the next time a relevant situation comes up." },
  { pattern: /^(ask|question)\b/i, build: () => "This week, ask yourself this before making a similar decision." },
  { pattern: /^(start|begin)\b/i, build: () => "This week, start small — apply this to one real task." },
  { pattern: /^(remember|focus|choose|treat)\b/i, build: () => "This week, keep this in mind the next time it's relevant." },
  { pattern: /\b(does not|cannot|are unwilling|fail(s)? to|refuse(s)? to)\b/i, build: () => "This week, notice one place where this is quietly true for you, and do the opposite." },
  { pattern: /\b(is the (result|cause|measure) of|leads to|results in|is rooted in)\b/i, build: () => "This week, trace one result in your own life back to this cause, and adjust the cause." },
  { pattern: /\b(should|must|has to|ought to)\b/i, build: () => "This week, hold yourself to this the next time it applies." },
];

const GENERIC_ACTION_TEMPLATES = [
  "This week, find one real situation where you can put this into practice.",
  "This week, write down one place in your life where this idea already applies.",
  "This week, test this against one real decision you're facing.",
  "This week, spend two minutes reflecting on how this shows up in your own life.",
];

/** Deterministic (not random) so the same claim always gets the same fallback line. */
function hashToIndex(text: string, mod: number): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash) % mod;
}

function buildActionTemplate(claimSentence: string): string {
  const trimmed = claimSentence.trim();
  const match = ACTION_TEMPLATES.find((t) => t.pattern.test(trimmed));
  if (match) return match.build();
  return GENERIC_ACTION_TEMPLATES[hashToIndex(trimmed, GENERIC_ACTION_TEMPLATES.length)]!;
}

function deriveTitle(claimSentence: string): string {
  const trimmed = claimSentence.trim().replace(/[.?!]+$/, "");
  if (trimmed.length <= 60) return trimmed;
  // Prefer cutting at the first clause boundary — a complete clause reads as
  // a real title; an arbitrary word-boundary truncation reads as cut off
  // mid-thought, which is what a flat 60-char cut alone produced.
  const clauseMatch = trimmed.slice(0, 70).match(/^(.{20,60}?)[,;:—]\s/);
  if (clauseMatch?.[1]) return clauseMatch[1].trim();
  const cut = trimmed.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trim();
}

const MAX_CANDIDATES_PER_CHUNK = 3;
const MIN_SENTENCE_GAP = 2;

/**
 * The path that runs with no model provider configured. Deterministic,
 * keyless, sentence-level salience scoring — imperative/causal-marker
 * detection, position weighting, optional embedding-centrality — with the
 * verbatim selected sentence as provenance, so grounding is correct by
 * construction rather than checked after the fact.
 */
export class HeuristicProvider implements LlmProvider {
  constructor(private readonly embed?: Embedder) {}

  async triageChunk(input: ChunkTriageInput): Promise<ChunkTriageResult> {
    const sentences = splitIntoSentences(input.chunkText);
    const cueHits = sentences.filter(
      (s) => IMPERATIVE_CUE.test(s) || CAUSAL_CUE.test(s) || YOU_SHOULD_CUE.test(s),
    ).length;
    const hasExtractableLesson =
      input.chunkText.trim().length > 300 && (cueHits > 0 || sentences.length >= 5);
    const confidence = sentences.length > 0 ? Math.min(1, (cueHits + 1) / sentences.length) : 0;
    return { hasExtractableLesson, confidence };
  }

  async extractLessons(input: ExtractLessonsInput): Promise<CandidateLesson[]> {
    const sentences = splitIntoSentences(input.chunkText);
    if (sentences.length === 0) return [];

    let centralityScores: number[] | null = null;
    if (this.embed) {
      const embeddings = await this.embed(sentences);
      const mean = meanVector(embeddings);
      centralityScores = embeddings.map((e) => cosineSimilarity(e, mean));
    }

    const scored = sentences.map((sentence, index) => ({
      sentence,
      index,
      score:
        scoreSentence(sentence, index, sentences.length) +
        (centralityScores ? (centralityScores[index] ?? 0) * 2 : 0),
    }));
    scored.sort((a, b) => b.score - a.score);

    const selected: typeof scored = [];
    for (const s of scored) {
      if (selected.length >= MAX_CANDIDATES_PER_CHUNK) break;
      if (s.score <= 0) continue;
      if (selected.some((sel) => Math.abs(sel.index - s.index) < MIN_SENTENCE_GAP)) continue;
      selected.push(s);
    }
    selected.sort((a, b) => a.index - b.index);

    const candidates = selected.map(({ sentence, index }) => {
      const mechanismSentences = sentences.slice(index + 1, index + 3);
      const mechanism = mechanismSentences.length > 0 ? mechanismSentences.join(" ") : sentence;
      const candidate: CandidateLesson = {
        title: deriveTitle(sentence),
        coreClaim: sentence,
        mechanism,
        actionTemplate: buildActionTemplate(sentence),
        evidenceStrength: classifyEvidenceStrength(`${sentence} ${mechanism}`),
        provenanceQuote: sentence,
        pageRef: input.pageStart,
        sourceChunkId: input.sourceChunkId,
      };
      return candidate;
    });

    // Provider-independent hallucination firewall, applied at the source —
    // the second of two independent enforcement points on the merged
    // platform (the DB's provenance_quote NOT NULL constraint is the other).
    return candidates.filter((c) => isGrounded(c, input.chunkText));
  }

  async mergeLessons(input: MergeLessonsInput): Promise<CandidateLesson[]> {
    if (input.candidates.length === 0) return [];

    // ONE embed() call for the whole array, not one per candidate. The
    // per-candidate version (`await this.embed!([candidate.coreClaim])`
    // inside a `Promise.all(candidates.map(...))`) is what ULM shipped, and
    // it means the embedder's own internal batching (BATCH_SIZE=16 in the
    // worker's real embedTexts) never engages — every call is a batch of
    // one. Measured live (merge-bench.mjs, 2026-09-01/02, real MiniLM model,
    // 300 synthetic candidates): 1.7x on the embed step alone from this
    // change, batched vs per-candidate, holding the model and the
    // clusterAndRank hot loop fixed. Order is preserved by construction —
    // `embed` returns one vector per input string, same order — so zipping
    // index-for-index back onto `input.candidates` is safe.
    let items: ScoredCandidate[];
    if (this.embed) {
      const embeddings = await this.embed(input.candidates.map((c) => c.coreClaim));
      items = input.candidates.map((candidate, i) => ({
        candidate,
        embedding: embeddings[i] ?? [],
      }));
    } else {
      items = input.candidates.map((candidate) => ({ candidate, embedding: [] }));
    }

    return clusterAndRank(items, input.targetCount.max);
  }

  async generateCards(input: GenerateCardsInput): Promise<GeneratedCard[]> {
    return generateCardsForLesson(input.lesson);
  }

  async gradeAnswer(input: GradeAnswerInput): Promise<GradeAnswerResult> {
    // No model to grade with on the keyless path — a crude token-overlap
    // self-check rather than a fabricated "confident" grade. This is a
    // fallback, not a claim of quality.
    const normalize = (s: string) =>
      new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const answerWords = normalize(input.cardAnswer);
    const userWords = normalize(input.userAnswer);
    const overlap = [...userWords].filter((w) => answerWords.has(w)).length;
    const overlapRatio = answerWords.size > 0 ? overlap / answerWords.size : 0;

    const suggestedRating: 1 | 2 | 3 | 4 =
      overlapRatio > 0.6 ? 3 : overlapRatio > 0.3 ? 2 : 1;

    return {
      suggestedRating,
      feedback:
        "Heuristic grading (no AI provider configured) — a rough keyword-overlap estimate, not a real assessment. Self-grade against the answer shown.",
    };
  }

  async checkEntailment(_input: EntailmentCheckInput): Promise<EntailmentCheckResult> {
    // Trivially always SUPPORTS: HeuristicProvider sets coreClaim ===
    // provenanceQuote by construction (no generation capability), so claim
    // and quote are the identical string here — there is nothing for a real
    // entailment check to find, and no model to call anyway.
    return { verdict: "SUPPORTS", reason: "heuristic provider: claim is the quote by construction" };
  }
}
