import { blockSlotOf, type DocWords } from "./doc-words";

// Pure RSVP engine pieces: where the focal (ORP) letter sits, how long each word is shown, and sentence/paragraph
// navigation over a DocWords. No timers or DOM here; use-rsvp-player owns the clock.

export const MIN_WPM = 100;
export const MAX_WPM = 1000;
export const WPM_STEP = 25;

export function clampWpm(wpm: number): number {
  if (!Number.isFinite(wpm)) return MIN_WPM;
  return Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(wpm)));
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Leading punctuation/quotes before the first letter or digit ("(\"Hello" -> 2). */
function leadLength(word: string): number {
  for (let i = 0; i < word.length; ) {
    const cp = String.fromCodePoint(word.codePointAt(i)!);
    if (LETTER_OR_DIGIT.test(cp)) return i;
    i += cp.length;
  }
  return 0;
}

/** Count of letters/digits-and-inner-marks between the leading and trailing punctuation. */
function coreLength(word: string): number {
  const chars = Array.from(word);
  let start = 0;
  while (start < chars.length && !LETTER_OR_DIGIT.test(chars[start])) start++;
  let end = chars.length;
  while (end > start && !LETTER_OR_DIGIT.test(chars[end - 1])) end--;
  return end - start;
}

/**
 * UTF-16 index of the optimal recognition point: len 1 -> 0, 2-5 -> 1, 6-9 -> 2, 10-13 -> 3, longer -> 4,
 * counted from the first letter so leading quotes/brackets never shift it. Always inside the word.
 */
export function orpIndex(word: string): number {
  if (word.length === 0) return 0;
  const lead = leadLength(word);
  const len = coreLength(word);
  const offset = len <= 1 ? 0 : len <= 5 ? 1 : len <= 9 ? 2 : len <= 13 ? 3 : 4;
  const chars = Array.from(word);
  const target = Math.min(chars.length - 1, Array.from(word.slice(0, lead)).length + Math.min(offset, Math.max(0, len - 1)));
  return chars.slice(0, target).join("").length;
}

/** Trailing sentence/clause punctuation, ignoring closing quotes and brackets ("end.\"" still ends a sentence). */
function trailingPunct(word: string): string {
  const m = /([.!?…;:,—–])[)\]}"'”’»]*$/u.exec(word);
  return m ? m[1] : "";
}

const ABBREVIATIONS = new Set([
  "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.", "st.", "vs.", "etc.", "e.g.", "i.e.", "cf.", "no.", "fig.", "inc.", "ltd.",
]);

export function endsSentence(word: string): boolean {
  const p = trailingPunct(word);
  if (p !== "." && p !== "!" && p !== "?" && p !== "…") return false;
  if (p === ".") {
    const bare = word.replace(/[)\]}"'”’»]+$/u, "");
    if (ABBREVIATIONS.has(bare.toLowerCase())) return false;
    // Single capital initial: "J." in "J. R. Tolkien".
    if (/^\p{Lu}\.$/u.test(bare)) return false;
  }
  return true;
}

/**
 * Milliseconds a word stays on screen: 60000/wpm base, longer after sentence ends (x2.2) and clause marks (x1.6),
 * longer for words over 8 letters (x1.3), plus an extra beat at a paragraph end.
 */
export function delayMs(word: string, wpm: number, opts: { paragraphEnd?: boolean } = {}): number {
  const base = 60000 / clampWpm(wpm);
  let factor = 1;
  const p = trailingPunct(word);
  if (endsSentence(word)) factor *= 2.2;
  else if (p === "," || p === ";" || p === ":" || p === "—" || p === "–") factor *= 1.6;
  if (coreLength(word) > 8) factor *= 1.3;
  let ms = base * factor;
  if (opts.paragraphEnd) ms += base * 1.5;
  return Math.round(ms);
}

function isBlockStart(dw: DocWords, index: number): boolean {
  if (dw.blockStarts.length === 0) return false;
  return dw.blockStarts[blockSlotOf(dw, index)] === index;
}

/** True when `index` is the last word of its block. */
export function isParagraphEnd(dw: DocWords, index: number): boolean {
  if (index >= dw.words.length - 1) return true;
  return isBlockStart(dw, index + 1);
}

/** First word of the sentence containing `index` (blocks are always sentence boundaries). */
export function sentenceStart(dw: DocWords, index: number): number {
  let i = Math.min(Math.max(0, index), Math.max(0, dw.words.length - 1));
  while (i > 0 && !isBlockStart(dw, i) && !endsSentence(dw.words[i - 1])) i--;
  return i;
}

/** First word of the sentence after the one containing `index`; the last word when there is none. */
export function nextSentenceStart(dw: DocWords, index: number): number {
  const last = Math.max(0, dw.words.length - 1);
  let i = Math.max(0, index);
  while (i < last) {
    if (endsSentence(dw.words[i]) || isParagraphEnd(dw, i)) return i + 1;
    i++;
  }
  return last;
}

/** "Back" like a music player: to the start of this sentence, or of the previous one when already at the start. */
export function backSentence(dw: DocWords, index: number): number {
  const start = sentenceStart(dw, index);
  if (index > start) return start;
  return start === 0 ? 0 : sentenceStart(dw, start - 1);
}

export function forwardSentence(dw: DocWords, index: number): number {
  return nextSentenceStart(dw, index);
}

export function paragraphStart(dw: DocWords, index: number): number {
  if (dw.blockStarts.length === 0) return 0;
  return dw.blockStarts[blockSlotOf(dw, index)];
}

export function backParagraph(dw: DocWords, index: number): number {
  const start = paragraphStart(dw, index);
  if (index > start) return start;
  const slot = blockSlotOf(dw, start);
  return slot === 0 ? 0 : dw.blockStarts[slot - 1];
}

export function forwardParagraph(dw: DocWords, index: number): number {
  if (dw.blockStarts.length === 0) return 0;
  const slot = blockSlotOf(dw, index);
  const next = dw.blockStarts[slot + 1];
  return next === undefined ? Math.max(0, dw.words.length - 1) : next;
}

/** Whole minutes (rounded up) to finish from `index` at `wpm`; 0 once done. */
export function minutesLeft(totalWords: number, index: number, wpm: number): number {
  const remaining = Math.max(0, totalWords - 1 - index);
  if (remaining === 0) return 0;
  return Math.max(1, Math.ceil(remaining / clampWpm(wpm)));
}

export function percentRead(totalWords: number, index: number): number {
  if (totalWords <= 1) return totalWords === 1 ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((index / (totalWords - 1)) * 100)));
}
