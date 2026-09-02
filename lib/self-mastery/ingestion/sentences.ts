const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z0-9"'“])/;

/**
 * Deliberately conservative sentence splitter, shared by chunking and lesson
 * extraction so a sentence's boundaries agree everywhere it's used — an
 * over-eager split (e.g. on "Mr.") would corrupt a mid-sentence quote's
 * provenance span later. Collapses whitespace, which is fine for the
 * grounding check since `isGrounded` normalizes both sides the same way
 * before comparing.
 */
export function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  return normalized
    .split(SENTENCE_BOUNDARY)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
