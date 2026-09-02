import type { CandidateLesson, GeneratedCard } from "./llm/types";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "with", "by", "from", "as", "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those", "it", "its", "you", "your", "we", "our",
  "they", "their", "he", "she", "his", "her", "not", "no", "do", "does", "did",
  "can", "could", "will", "would", "should", "may", "might", "must", "have",
  "has", "had", "if", "then", "than", "so", "because", "which", "who", "what",
  "when", "where", "why", "how", "there", "here", "all", "any", "one", "into",
]);

/**
 * Rough noun-preference heuristic without a real POS tagger: adverbs and
 * verb-forms are rarely the load-bearing concept in a claim ("significantly",
 * "maintaining", "encouraging" all score as the longest word pre-fix, but
 * none of them is what the sentence is actually ABOUT). Penalize those
 * suffixes instead of just taking the longest word.
 */
function clozeSalienceScore(word: string): number {
  const lower = word.toLowerCase();
  let score = word.length;
  if (/ly$/.test(lower)) score -= 8; // adverbs
  if (/(ing|ed)$/.test(lower)) score -= 4; // verb forms
  return score;
}

/**
 * Picks a meaningful (non-stopword, >=4 char) term to blank for a cloze
 * card — excluding any word that also appears in the title, since blanking
 * a term the reader can just read off the visible title makes the card
 * trivial. Ranks by salience, not raw length, to prefer the claim's central
 * noun over a longer adverb.
 */
function pickClozeTerm(text: string, title: string): string | null {
  const titleWords = new Set((title.match(/[A-Za-z']+/g) ?? []).map((w) => w.toLowerCase()));
  const words = text.match(/[A-Za-z][A-Za-z'-]{3,}/g) ?? [];
  const candidates = words.filter(
    (w) => !STOPWORDS.has(w.toLowerCase()) && !titleWords.has(w.toLowerCase()),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, w) =>
    clozeSalienceScore(w) > clozeSalienceScore(best) ? w : best,
  );
}

/** Exported for reuse by OllamaProvider — cloze stays fully heuristic
 * regardless of extraction provider (mechanical task, no model needed). */
export function buildClozeCard(lesson: CandidateLesson): GeneratedCard | null {
  const term = pickClozeTerm(lesson.coreClaim, lesson.title);
  if (!term) return null;
  const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  if (!pattern.test(lesson.coreClaim)) return null;
  const prompt = lesson.coreClaim.replace(pattern, "____");
  if (prompt === lesson.coreClaim) return null;
  // Answer must not be recoverable from the visible prompt remainder itself
  // (e.g. the term appearing twice in the claim).
  if (pattern.test(prompt)) return null;
  return { promptType: "cloze", prompt, answer: term };
}

/**
 * A short topic anchor (1-2 salient keywords), not a restatement — quoting
 * the full title/claim in a prompt leaks most of the answer. This is the
 * heuristic path's honest ceiling without real paraphrase capability: low
 * word-overlap by construction, at the cost of being a vaguer prompt than a
 * generated one would be.
 *
 * Joined with "and", never "/" — a 2-keyword anchor joined as e.g.
 * "reluctance / forgotten" collides with `passesCardTextSanity`'s
 * SPACED_SLASH_ARTIFACT gate (invariants.ts), which treats any " / " as an
 * unresolved template artifact and rejects the whole prompt. That gate is
 * correct — a real slash idiom never has surrounding spaces — so joining on
 * "/" was the wrong side of the collision: it silently dropped nearly every
 * free_recall/application/why card this function produced once the write-time
 * gate started applying the same check.
 */
function extractTopicAnchor(text: string, count = 2): string {
  const words = text.match(/[A-Za-z][A-Za-z'-]{3,}/g) ?? [];
  const candidates = words.filter((w) => !STOPWORDS.has(w.toLowerCase()));
  const unique = [...new Set(candidates.map((w) => w.toLowerCase()))];
  const topic = unique.sort((a, b) => b.length - a.length).slice(0, count);
  return topic.length > 0 ? topic.join(" and ") : "this idea";
}

/**
 * 2-4 prompts per lesson, mixed types, at least one free_recall (the
 * generation effect is the point) and at least one non-recall type.
 * Deterministic — no LLM call, works identically for both providers' output
 * shape (CandidateLesson). Still passes through the anti-leak invariant gate
 * (invariants.ts) like every other provider's output — this function tries
 * to produce low-overlap prompts, but the gate is the actual guarantee, not
 * this function's care.
 */
export function generateCardsForLesson(lesson: CandidateLesson): GeneratedCard[] {
  const cards: GeneratedCard[] = [];
  const topic = extractTopicAnchor(lesson.coreClaim);

  cards.push({
    promptType: "free_recall",
    prompt: `From page ${lesson.pageRef}: what does this lesson say about ${topic}? Recall it in your own words before checking.`,
    answer: lesson.coreClaim,
  });

  cards.push({
    promptType: "application",
    prompt: `Think of a real situation touching on ${topic} — what would this lesson have you do?`,
    answer: lesson.actionTemplate,
  });

  const cloze = buildClozeCard(lesson);
  if (cloze) cards.push(cloze);

  cards.push({
    promptType: "why",
    prompt: `Why does the idea about ${topic} actually work — what's the mechanism?`,
    answer: lesson.mechanism,
  });

  // Cap at 4; free_recall (index 0) and at least one non-recall type
  // (application, index 1) are always present regardless of which optional
  // cards made it in.
  return cards.slice(0, 4);
}
