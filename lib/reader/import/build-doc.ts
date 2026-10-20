import { tokenizeBlock } from "../tokenize";
import { READER_DOC_VERSION, type ReaderBlock, type ReaderChapter, type ReaderDoc, type ReaderSource } from "../types";
import { ReaderImportError } from "./errors";
import type { RawBlock } from "./cleanup";

export interface BuildDocInput {
  title: string;
  author?: string | null;
  source: ReaderSource;
  sourceUrl?: string | null;
  blocks: RawBlock[];
  /** Chapter starts as indexes into `blocks` (the INPUT array, before empty blocks are dropped). */
  chapterStarts?: { title: string; blockIndex: number }[];
  /** When no chapterStarts resolve, derive chapters from heading blocks. Default true. */
  headingFallback?: boolean;
}

/**
 * The one place a ReaderDoc is assembled: drops empty blocks, assigns global firstWord via the shared tokenizer, and
 * resolves chapters (explicit starts -> heading blocks -> one chapter titled after the document).
 */
export function buildReaderDoc(input: BuildDocInput): ReaderDoc {
  const blocks: ReaderBlock[] = [];
  const inputToOutput = new Map<number, number>();
  let words = 0;
  input.blocks.forEach((b, i) => {
    const n = tokenizeBlock(b.text).length;
    if (n === 0) return;
    inputToOutput.set(i, blocks.length);
    blocks.push({ kind: b.kind, text: b.text, firstWord: words });
    words += n;
  });
  if (words === 0) throw new ReaderImportError("empty");

  // An input index that pointed at a dropped (empty) block resolves to the next surviving block.
  const resolve = (inputIndex: number): number | null => {
    for (let i = Math.max(0, inputIndex); i < input.blocks.length; i++) {
      const out = inputToOutput.get(i);
      if (out !== undefined) return out;
    }
    return null;
  };

  let chapters: ReaderChapter[] = [];
  for (const c of input.chapterStarts ?? []) {
    const bi = resolve(c.blockIndex);
    const title = c.title.replace(/\s+/g, " ").trim();
    if (bi === null || !title) continue;
    chapters.push({ title, blockIndex: bi, firstWord: blocks[bi].firstWord });
  }
  chapters.sort((a, b) => a.blockIndex - b.blockIndex);
  // Two entries at one position: keep the first (the outer / earlier one).
  chapters = chapters.filter((c, i) => i === 0 || c.blockIndex !== chapters[i - 1].blockIndex);

  if (chapters.length === 0 && input.headingFallback !== false) {
    chapters = blocks
      .map((b, bi) => ({ b, bi }))
      .filter(({ b }) => b.kind === "h")
      .map(({ b, bi }) => ({ title: b.text, blockIndex: bi, firstWord: b.firstWord }));
  }
  if (chapters.length === 0) {
    chapters = [{ title: input.title, blockIndex: 0, firstWord: 0 }];
  }

  return {
    version: READER_DOC_VERSION,
    title: input.title,
    author: input.author?.trim() || null,
    source: input.source,
    sourceUrl: input.sourceUrl ?? null,
    blocks,
    chapters,
    wordCount: words,
  };
}
