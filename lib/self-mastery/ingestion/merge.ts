import type { CandidateLesson, EvidenceStrength } from "./llm/types";

export interface ScoredCandidate {
  candidate: CandidateLesson;
  embedding: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
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

const EVIDENCE_WEIGHT: Record<EvidenceStrength, number> = {
  strong_research: 3,
  single_study: 2,
  author_anecdote: 1,
};

const ACTIONABLE_CUE = /\b(you should|try|use|start|avoid|ask yourself|practice|apply)\b/i;

/**
 * Re-derives an actionability/quality score from the candidate's own text —
 * deliberately not threaded through from the extraction stage's salience
 * score, so this works identically for a merge input built by either
 * provider.
 */
export function scoreActionability(candidate: CandidateLesson): number {
  let score = EVIDENCE_WEIGHT[candidate.evidenceStrength] * 2;
  if (ACTIONABLE_CUE.test(candidate.actionTemplate)) score += 3;
  if (ACTIONABLE_CUE.test(candidate.coreClaim)) score += 1;
  score += Math.min(candidate.mechanism.length / 100, 3); // longer mechanism = more explained, capped
  if (/^[A-Z][a-z]+ /.test(candidate.title) && !candidate.title.startsWith("On ")) score += 1; // imperative-ish title
  return score;
}

/**
 * ULM ruling: the floor is 6, not 30 — a 30-lesson floor is nonsense for a
 * 40-page book, and the 60 cap is what actually binds on real books; a hard
 * 30-lesson floor on a short book would force padding with weaker candidates
 * just to hit a number. Caller uses this to build `MergeLessonsInput.targetCount`
 * — min = max = this value, since the spec defines a single target count,
 * not a genuine range.
 */
export function computeTargetLessonCount(pageCount: number): number {
  return Math.min(60, Math.max(6, Math.round(pageCount / 8)));
}

/**
 * The point at which "Start learning now" becomes real for a book still
 * mid-ingestion — a FIXED threshold here is the same bug class as the
 * once-fixed 30-lesson floor above (a fixed number applied to a
 * variable-sized book): it would structurally exclude any book whose
 * `targetCount` never reaches it, including a short onboarding sample book.
 * Scaled instead: half of `targetCount`, floored at 3 (still a real
 * warm-up-sized deck, not a teaser) and capped at `ceiling` (still "enough
 * cards for a real first session" on a large book, not the whole target).
 */
export function computePartialThreshold(targetCount: number, ceiling = 10, floor = 3): number {
  return Math.min(ceiling, Math.max(floor, Math.ceil(targetCount / 2)));
}

/**
 * Cluster by embedding cosine similarity (~0.86), collapse each cluster to
 * its best representative, then rank and keep the top N, deliberately
 * spreading selection across the book (page-range buckets) rather than
 * clustering in one chapter.
 *
 * `n` is resolved by the caller from `MergeLessonsInput.targetCount` — this
 * function doesn't compute the target itself since the LlmProvider contract
 * only carries {min, max}, not raw page_count. A book that genuinely doesn't
 * have `min` clusters worth keeping is left short rather than padded with
 * invented lessons — that would violate "no provenance, no lesson" in
 * spirit even if each individual lesson still had one.
 */
export function clusterAndRank(items: ScoredCandidate[], n: number): CandidateLesson[] {
  if (items.length === 0) return [];

  const SIMILARITY_THRESHOLD = 0.86;
  const clusters: ScoredCandidate[][] = [];

  for (const item of items) {
    let placed = false;
    for (const cluster of clusters) {
      const rep = cluster[0];
      if (rep && cosineSimilarity(rep.embedding, item.embedding) >= SIMILARITY_THRESHOLD) {
        cluster.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([item]);
  }

  const representatives: CandidateLesson[] = clusters.map((cluster) => {
    // Tie-break: longest mechanism + strongest evidence + earliest page.
    const best = [...cluster].sort((a, b) => {
      const evidenceDiff =
        EVIDENCE_WEIGHT[b.candidate.evidenceStrength] - EVIDENCE_WEIGHT[a.candidate.evidenceStrength];
      if (evidenceDiff !== 0) return evidenceDiff;
      const mechanismDiff = b.candidate.mechanism.length - a.candidate.mechanism.length;
      if (mechanismDiff !== 0) return mechanismDiff;
      return a.candidate.pageRef - b.candidate.pageRef;
    })[0];
    return best!.candidate;
  });

  if (representatives.length <= n) return representatives;

  // Spread selection across the book: bucket by page position into n
  // buckets, take the single best-scoring candidate per bucket first
  // (guarantees coverage), then fill remaining slots by score across
  // whatever's left.
  const scored = representatives
    .map((c) => ({ candidate: c, score: scoreActionability(c) }))
    .sort((a, b) => b.score - a.score);

  const minPage = Math.min(...representatives.map((c) => c.pageRef));
  const maxPage = Math.max(...representatives.map((c) => c.pageRef));
  const span = Math.max(1, maxPage - minPage);
  const bucketOf = (page: number) => Math.min(n - 1, Math.floor(((page - minPage) / span) * n));

  const buckets = new Map<number, typeof scored>();
  for (const s of scored) {
    const b = bucketOf(s.candidate.pageRef);
    const arr = buckets.get(b) ?? [];
    arr.push(s);
    buckets.set(b, arr);
  }

  const selected: CandidateLesson[] = [];
  const used = new Set<CandidateLesson>();
  for (const arr of buckets.values()) {
    const top = arr[0];
    if (top && selected.length < n) {
      selected.push(top.candidate);
      used.add(top.candidate);
    }
  }
  for (const s of scored) {
    if (selected.length >= n) break;
    if (!used.has(s.candidate)) {
      selected.push(s.candidate);
      used.add(s.candidate);
    }
  }

  return selected.slice(0, n);
}
