import type { ReaderChapter, ReaderDoc } from "./types";
import { tokenizeBlock } from "./tokenize";

// The flat word list of a ReaderDoc, built with the one shared tokenizer so a client index always means the same word
// the server counted. Block starts are kept so sentence/paragraph navigation never re-scans the text.
export interface DocWords {
  words: string[];
  /** Global index of each block's first word (empty blocks are skipped, so this stays strictly increasing). */
  blockStarts: number[];
  /** Block index in `doc.blocks` for each entry of `blockStarts`. */
  blockIds: number[];
}

export function buildDocWords(doc: Pick<ReaderDoc, "blocks">): DocWords {
  const words: string[] = [];
  const blockStarts: number[] = [];
  const blockIds: number[] = [];
  doc.blocks.forEach((block, id) => {
    const tokens = tokenizeBlock(block.text);
    if (tokens.length === 0) return;
    blockStarts.push(words.length);
    blockIds.push(id);
    for (const t of tokens) words.push(t);
  });
  return { words, blockStarts, blockIds };
}

/** Position in `blockStarts` of the block containing `wordIndex` (last start <= wordIndex). */
export function blockSlotOf(dw: DocWords, wordIndex: number): number {
  let lo = 0;
  let hi = dw.blockStarts.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dw.blockStarts[mid] <= wordIndex) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** Index of the chapter containing `wordIndex`, or -1 when the doc has none / the word precedes the first. */
export function chapterIndexAt(chapters: Pick<ReaderChapter, "firstWord">[], wordIndex: number): number {
  let ans = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].firstWord <= wordIndex) ans = i;
    else break;
  }
  return ans;
}

/** Word index for a character offset inside a block's text (offset inside a word -> that word; in a gap -> the next word). */
export function wordIndexAtOffset(text: string, offset: number): number {
  const re = /\S+/g;
  let idx = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    last = idx;
    if (offset <= m.index + m[0].length) return idx;
    idx++;
  }
  return last;
}
