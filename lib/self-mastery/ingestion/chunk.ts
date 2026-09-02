import type { Chunk, DetectedSection, ExtractedPage } from "./types";
import { isSkippableSectionTitle, looksLikeHeading } from "./structure";
import { splitIntoSentences as splitTextIntoSentences } from "./sentences";

const TARGET_CHUNK_TOKENS = 3000;
const OVERLAP_TOKENS = 150;
const CHARS_PER_TOKEN = 4;
// ULM L6 §3 finding: "never split mid-sentence" has no ceiling for a
// degenerate "sentence" — live-verified a 188,889-character run with zero
// terminators (malformed extraction: a table, an index, an OCR artefact)
// produced a 47,223-token chunk, 15.7x target. Two concrete costs: the LLM
// prompt gets a chunk far past what's useful, and — the decisive one — the
// embedding model (MiniLM, ~256-token input limit) truncates it, so the
// stored embedding represents a tiny, arbitrary fraction of the chunk's
// actual content, silently meaningless for dedup/merge/similarity gates
// downstream. Hard-capped, not truncated — an oversized run is SPLIT
// instead, preferring a whitespace boundary and falling back to a raw
// character cut only if a single "word" itself exceeds the cap.
const HARD_CAP_TOKENS = 4000;
const HARD_CAP_CHARS = HARD_CAP_TOKENS * CHARS_PER_TOKEN;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

interface Sentence {
  text: string;
  page: number;
}

/** Splits one sentence that alone exceeds `HARD_CAP_TOKENS` into pieces that
 * don't — greedily packed on whitespace boundaries so this still prefers a
 * natural word break over an arbitrary character cut. A single "word" longer
 * than the cap (no whitespace anywhere) is the only case that falls back to
 * a hard character slice. */
function splitOversizedSentence(sentence: Sentence): Sentence[] {
  if (estimateTokens(sentence.text) <= HARD_CAP_TOKENS) return [sentence];

  const pieces: Sentence[] = [];
  const words = sentence.text.split(/(\s+)/);
  let buf = "";
  for (const word of words) {
    if (buf.length > 0 && buf.length + word.length > HARD_CAP_CHARS) {
      pieces.push({ text: buf, page: sentence.page });
      buf = "";
    }
    if (word.length > HARD_CAP_CHARS) {
      for (let i = 0; i < word.length; i += HARD_CAP_CHARS) {
        pieces.push({ text: word.slice(i, i + HARD_CAP_CHARS), page: sentence.page });
      }
      continue;
    }
    buf += word;
  }
  if (buf.length > 0) pieces.push({ text: buf, page: sentence.page });
  return pieces;
}

/** Strips standalone heading-like lines before sentence-splitting. */
function stripHeadingLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !looksLikeHeading(line))
    .join("\n");
}

function splitIntoSentences(pages: ExtractedPage[]): Sentence[] {
  const sentences: Sentence[] = [];
  for (const p of pages) {
    for (const text of splitTextIntoSentences(stripHeadingLines(p.text))) {
      sentences.push(...splitOversizedSentence({ text, page: p.page }));
    }
  }
  return sentences;
}

function chunkSentences(
  sentences: Sentence[],
  sectionIndex: number | null,
  startSortOrder: number,
): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Sentence[] = [];
  let currentTokens = 0;
  let sortOrder = startSortOrder;

  const takeOverlapTail = (): Sentence[] => {
    const overlap: Sentence[] = [];
    let overlapTokens = 0;
    for (let i = current.length - 1; i >= 0 && overlapTokens < OVERLAP_TOKENS; i--) {
      const sent = current[i];
      if (!sent) break;
      const sentTokens = estimateTokens(sent.text);
      // A single sentence bigger than the whole overlap budget would defeat
      // the point of a small continuity tail — and since splitOversizedSentence
      // can produce pieces up to HARD_CAP_TOKENS, including one whole here is
      // exactly how the hard cap gets reintroduced through the back door.
      if (sentTokens > OVERLAP_TOKENS) break;
      overlap.unshift(sent);
      overlapTokens += sentTokens;
    }
    return overlap;
  };

  const flush = () => {
    if (current.length === 0) return;
    const text = current.map((s) => s.text).join(" ");
    const first = current[0];
    const last = current.at(-1);
    if (!first || !last) return;
    chunks.push({
      text,
      pageStart: first.page,
      pageEnd: last.page,
      tokenCount: estimateTokens(text),
      sortOrder: sortOrder++,
      sectionIndex,
    });
  };

  for (const s of sentences) {
    const sTokens = estimateTokens(s.text);
    // Safety net ahead of the target-based flush below: flush FIRST if
    // adding `s` would cross the hard cap, rather than after (every
    // post-splitOversizedSentence sentence is itself <= HARD_CAP_TOKENS, so
    // this alone is enough to guarantee no emitted chunk ever exceeds it).
    if (current.length > 0 && currentTokens + sTokens > HARD_CAP_TOKENS) {
      flush();
      const overlap = takeOverlapTail();
      current = overlap;
      currentTokens = overlap.reduce((sum, x) => sum + estimateTokens(x.text), 0);
    }

    current.push(s);
    currentTokens += sTokens;
    if (currentTokens >= TARGET_CHUNK_TOKENS) {
      flush();
      const overlap = takeOverlapTail();
      current = overlap;
      currentTokens = overlap.reduce((sum, x) => sum + estimateTokens(x.text), 0);
    }
  }
  flush();

  return chunks;
}

/**
 * ~2-4k token chunks, ~150-token overlap, aligned to section boundaries
 * (chunking resets per-section rather than carrying overlap across a
 * section break), never splitting mid-sentence. Skippable sections
 * (front/back matter) are dropped entirely.
 */
export function chunkBook(pages: ExtractedPage[], sections: DetectedSection[]): Chunk[] {
  const chunks: Chunk[] = [];
  let sortOrder = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section || isSkippableSectionTitle(section.title)) continue;

    const sectionPages = pages.filter(
      (p) => p.page >= section.pageStart && p.page <= section.pageEnd,
    );
    const sentences = splitIntoSentences(sectionPages);
    if (sentences.length === 0) continue;

    const sectionChunks = chunkSentences(sentences, i, sortOrder);
    chunks.push(...sectionChunks);
    sortOrder += sectionChunks.length;
  }

  return chunks;
}
