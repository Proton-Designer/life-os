// Pure (no React): turns a source chunk + a lesson's provenance quote into
// something a person can read. A chunk averages ~4,500 chars with ZERO
// newlines (paragraph breaks are lost at chunking), and the quote is not
// marked anywhere in it — so the "In context" dialog used to be one wall of
// text. This finds the quote, keeps a few sentences either side, and splits
// them into short paragraphs. It only ever re-slices the book's own text —
// the dialog exists to prove the lesson came from the book, so nothing here
// paraphrases or invents a character.

export type Segment = { text: string; highlighted: boolean };
export type Paragraph = Segment[];
export type Range = { start: number; end: number };

export type ContextView = {
  // False when the quote could not be located in the chunk (nothing is marked).
  found: boolean;
  window: { paragraphs: Paragraph[]; hasMoreBefore: boolean; hasMoreAfter: boolean };
  // The whole chunk, same paragraphing and highlight, for "Show full passage".
  full: Paragraph[];
};

const CONTEXT_SENTENCES = 2;
const SENTENCES_PER_PARAGRAPH = 3;
const FALLBACK_SENTENCES = 5;

// The quote and the chunk differ in punctuation, whitespace and quote marks,
// so compare lowercase [a-z0-9] only, keeping each kept char's ORIGINAL index.
function normalize(text: string): { norm: string; index: number[] } {
  let norm = "";
  const index: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i].toLowerCase();
    if (c.length === 1 && /[a-z0-9]/.test(c)) {
      norm += c;
      index.push(i);
    }
  }
  return { norm, index };
}

export function findQuoteRange(text: string, quote: string): Range | null {
  const q = normalize(quote).norm;
  if (q.length === 0) return null;
  const { norm, index } = normalize(text);
  const at = norm.indexOf(q);
  if (at === -1) return null;
  // The normalized match stops at the last letter/digit; take the sentence's
  // own closing mark (and quote) with it so the highlight doesn't leave a
  // stray "." behind. Same for an opening quote mark just before it.
  let start = index[at];
  let end = index[at + q.length - 1] + 1;
  const closing = /^[.!?]["”’')\]]?/.exec(text.slice(end));
  if (closing) end += closing[0].length;
  if (start > 0 && /["“‘'(]/.test(text[start - 1])) start -= 1;
  return { start, end };
}

const ABBREVIATIONS = new Set(["e.g", "i.e", "dr", "mr", "mrs", "ms", "vs", "no", "p", "pp", "st", "jr", "sr", "etc", "cf", "fig"]);

// A sentence ends at . ! ? (plus an optional closing quote/bracket) and
// whitespace, when what follows starts like a sentence. A period after a known
// abbreviation or a single initial ("J. K. Rowling") does not end one.
export function splitSentences(text: string): Range[] {
  const ranges: Range[] = [];
  let start = 0;
  const boundary = /[.!?]["”’')\]]?\s+/g;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(text)) !== null) {
    const next = text[m.index + m[0].length];
    if (next === undefined || !/[A-Z0-9"“‘'(]/.test(next)) continue;
    if (m[0][0] === ".") {
      const word = /[A-Za-z.]+$/.exec(text.slice(0, m.index))?.[0].toLowerCase() ?? "";
      if (ABBREVIATIONS.has(word) || /^[a-z]$/.test(word)) continue;
    }
    pushTrimmed(ranges, text, start, m.index + m[0].length);
    start = m.index + m[0].length;
  }
  pushTrimmed(ranges, text, start, text.length);
  return ranges;
}

function pushTrimmed(into: Range[], text: string, start: number, end: number) {
  const slice = text.slice(start, end);
  const lead = slice.length - slice.trimStart().length;
  const trimmed = slice.trim();
  if (trimmed.length > 0) into.push({ start: start + lead, end: start + lead + trimmed.length });
}

// One paragraph = a run of consecutive sentences, cut into up to three
// segments: before the quote, the quote's exact range, after it.
function paragraphFor(text: string, from: number, to: number, quote: Range | null): Paragraph {
  const segs: Paragraph = [];
  const add = (a: number, b: number, highlighted: boolean) => {
    if (b > a) segs.push({ text: text.slice(a, b), highlighted });
  };
  if (!quote || quote.end <= from || quote.start >= to) {
    add(from, to, false);
    return segs;
  }
  const qs = Math.max(quote.start, from);
  const qe = Math.min(quote.end, to);
  add(from, qs, false);
  add(qs, qe, true);
  add(qe, to, false);
  return segs;
}

function paragraphs(text: string, sentences: Range[], quote: Range | null): Paragraph[] {
  const out: Paragraph[] = [];
  for (let i = 0; i < sentences.length; i += SENTENCES_PER_PARAGRAPH) {
    const group = sentences.slice(i, i + SENTENCES_PER_PARAGRAPH);
    out.push(paragraphFor(text, group[0].start, group[group.length - 1].end, quote));
  }
  return out;
}

export function buildContextView(text: string, quote: string): ContextView {
  const sentences = splitSentences(text);
  const range = findQuoteRange(text, quote);
  const full = paragraphs(text, sentences, range);

  if (!range || sentences.length === 0) {
    return {
      found: false,
      window: {
        paragraphs: paragraphs(text, sentences.slice(0, FALLBACK_SENTENCES), null),
        hasMoreBefore: false,
        hasMoreAfter: sentences.length > FALLBACK_SENTENCES,
      },
      full,
    };
  }

  let first = sentences.findIndex((s) => s.end > range.start);
  let last = sentences.findLastIndex((s) => s.start < range.end);
  if (first === -1) first = sentences.length - 1;
  if (last === -1 || last < first) last = first;
  const from = Math.max(0, first - CONTEXT_SENTENCES);
  const to = Math.min(sentences.length - 1, last + CONTEXT_SENTENCES);
  return {
    found: true,
    window: {
      paragraphs: paragraphs(text, sentences.slice(from, to + 1), range),
      hasMoreBefore: from > 0,
      hasMoreAfter: to < sentences.length - 1,
    },
    full,
  };
}
