import { tokenizeBlock } from "../tokenize";
import type { RawBlock } from "./cleanup";

// Rebuild readable text for a book whose original file is gone (the ingestion pipeline deletes the PDF once a
// book is "ready") from the text it kept: source_chunks (sentence-packed, ~150 tokens of overlap between
// neighbours, heading lines stripped) + book_sections (the headings). Lossier than reading the file — page
// furniture was already removed, paragraph breaks are gone, headings come only from section titles — but every
// ingested book stays readable.

export interface ChunkInput {
  text: string;
  sort_order: number;
  section_id: string | null;
}

export interface SectionInput {
  id: string;
  title: string | null;
  sort_order: number;
}

/** "Full Book" is parseStructure's sentinel for "no structure found" — not a real chapter title. */
const NO_STRUCTURE_TITLE = /^full book$/i;
/** Only an overlap this long is trusted as "the same passage" (avoids chopping a coincidental repeated phrase). */
const MIN_OVERLAP_WORDS = 8;
const MAX_OVERLAP_WORDS = 700;
/** Target size of a rebuilt paragraph, split at sentence ends. */
const PARAGRAPH_WORDS = 110;

/** Words of `next` that repeat the tail of `prev` (the chunker's overlap), 0 when there isn't a trustworthy one. */
export function overlapWords(prev: string[], next: string[]): number {
  const max = Math.min(prev.length, next.length, MAX_OVERLAP_WORDS);
  for (let k = max; k >= MIN_OVERLAP_WORDS; k--) {
    let same = true;
    for (let i = 0; i < k; i++) {
      if (prev[prev.length - k + i] !== next[i]) {
        same = false;
        break;
      }
    }
    if (same) return k;
  }
  return 0;
}

/** Sentence-aware split of one long text into ~PARAGRAPH_WORDS paragraphs. */
export function paragraphsOf(text: string): string[] {
  const sentences = text.split(/(?<=[.!?]["')\]]?)\s+/).filter((s) => s.trim());
  const out: string[] = [];
  let cur: string[] = [];
  let words = 0;
  for (const s of sentences) {
    cur.push(s);
    words += tokenizeBlock(s).length;
    if (words >= PARAGRAPH_WORDS) {
      out.push(cur.join(" "));
      cur = [];
      words = 0;
    }
  }
  if (cur.length) out.push(cur.join(" "));
  return out;
}

export function chunksToBlocks(
  chunks: ChunkInput[],
  sections: SectionInput[]
): { blocks: RawBlock[]; chapterStarts: { title: string; blockIndex: number }[] } {
  const titleOf = new Map(sections.map((s) => [s.id, (s.title ?? "").replace(/\s+/g, " ").trim()]));
  const ordered = [...chunks].sort((a, b) => a.sort_order - b.sort_order);

  const blocks: RawBlock[] = [];
  const chapterStarts: { title: string; blockIndex: number }[] = [];
  let prevWords: string[] = [];
  let prevSection: string | null | undefined;

  for (const chunk of ordered) {
    if (chunk.section_id !== prevSection) {
      prevSection = chunk.section_id;
      const title = chunk.section_id ? titleOf.get(chunk.section_id) : "";
      if (title && !NO_STRUCTURE_TITLE.test(title)) {
        chapterStarts.push({ title, blockIndex: blocks.length });
        blocks.push({ kind: "h", text: title });
      }
    }
    const words = tokenizeBlock(chunk.text);
    if (words.length === 0) continue;
    const drop = overlapWords(prevWords, words);
    // Rebuild the text from the surviving words (the overlap is a word-for-word repeat, so nothing is lost).
    const text = drop > 0 ? words.slice(drop).join(" ") : chunk.text;
    prevWords = words;
    if (!text.trim()) continue;
    for (const p of paragraphsOf(text)) blocks.push({ kind: "p", text: p });
  }
  return { blocks, chapterStarts };
}
