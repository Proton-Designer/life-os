import type { DocWords } from "./doc-words";
import { blockSlotOf } from "./doc-words";
import { endsSentence, isParagraphEnd, sentenceStart } from "./rsvp";

// Pure highlight helpers shared by the reader screens: which words a highlight covers, the sentence around the current
// word, and how a block's text splits into marked / unmarked runs. The same word-index space as the position.

export interface HighlightItem {
  id: string;
  startWord: number;
  endWord: number;
  text: string;
  note?: string | null;
  createdAt: string;
}

export interface WordRange {
  start: number;
  end: number;
}

/** Longest passage one highlight may cover; longer selections are cut so the saved text stays a quote, not a chapter. */
export const MAX_HIGHLIGHT_WORDS = 300;

/** The sentence containing `index`, inclusive of both ends. */
export function sentenceRange(dw: DocWords, index: number): WordRange {
  const last = dw.words.length - 1;
  if (last < 0) return { start: 0, end: 0 };
  const start = sentenceStart(dw, index);
  let end = start;
  while (end < last && !endsSentence(dw.words[end]) && !isParagraphEnd(dw, end)) end++;
  return clampRange({ start, end });
}

export function clampRange(r: WordRange): WordRange {
  const start = Math.max(0, Math.min(r.start, r.end));
  const end = Math.max(r.start, r.end);
  return { start, end: Math.min(end, start + MAX_HIGHLIGHT_WORDS - 1) };
}

export function rangeText(dw: DocWords, r: WordRange): string {
  return dw.words.slice(r.start, r.end + 1).join(" ");
}

export function wordIsHighlighted(ranges: readonly WordRange[], word: number): boolean {
  for (const r of ranges) if (word >= r.start && word <= r.end) return true;
  return false;
}

const NONE: readonly WordRange[] = [];

/** Highlights grouped by the block ids they touch, so a block renders only its own ranges (stable empty array for the rest). */
export function rangesByBlock(dw: DocWords, highlights: readonly WordRange[]): { get(blockId: number): readonly WordRange[] } {
  const map = new Map<number, WordRange[]>();
  if (dw.blockStarts.length > 0) {
    for (const h of highlights) {
      const from = blockSlotOf(dw, h.start);
      const to = blockSlotOf(dw, Math.min(h.end, dw.words.length - 1));
      for (let slot = from; slot <= to; slot++) {
        const id = dw.blockIds[slot];
        const list = map.get(id);
        if (list) list.push(h);
        else map.set(id, [h]);
      }
    }
  }
  return { get: (id) => map.get(id) ?? NONE };
}

export interface TextRun {
  text: string;
  marked: boolean;
}

/** Splits a block's text into runs; whitespace between two marked words is marked too so a highlight reads as one band. */
export function segmentBlock(text: string, firstWord: number, ranges: readonly WordRange[]): TextRun[] {
  if (ranges.length === 0) return [{ text, marked: false }];
  const tokens = text.match(/\S+|\s+/g) ?? [];
  const flags: boolean[] = [];
  let word = firstWord;
  for (const t of tokens) {
    if (/^\s/.test(t)) flags.push(false);
    else flags.push(wordIsHighlighted(ranges, word++));
  }
  for (let i = 0; i < tokens.length; i++) {
    if (/^\s/.test(tokens[i]) && i > 0 && i < tokens.length - 1 && flags[i - 1] && flags[i + 1]) flags[i] = true;
  }
  const runs: TextRun[] = [];
  tokens.forEach((t, i) => {
    const last = runs[runs.length - 1];
    if (last && last.marked === flags[i]) last.text += t;
    else runs.push({ text: t, marked: flags[i] });
  });
  return runs;
}
