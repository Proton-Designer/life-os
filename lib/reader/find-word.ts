// "Open the reader where this passage is": a link carries the first words of a
// quote (?find=), and the reader turns them into a word index in its own
// document, then treats it exactly like ?at=. Pure; the word list comes from
// buildDocWords so an index here always means the word the reader counts.

const MAX_PHRASE_CHARS = 200;
const PHRASE_WORDS = 12;

const norm = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The first words of a quote, as sent in a reader link's `?find=`. */
export function quoteFindPhrase(quote: string, words = PHRASE_WORDS): string {
  return quote.split(/\s+/).filter(Boolean).slice(0, words).join(" ");
}

/** A reader link that opens at a quote: `readerHref` (`/read/<bookId>`) plus the quote's first words as `?find=`. */
export function findPhraseHref(readerHref: string, quote: string): string {
  return `${readerHref}?find=${encodeURIComponent(quoteFindPhrase(quote))}`;
}

/** The `?find=` phrase of a reader link, or null for nothing to search for. Capped so a pasted blob can't become a scan key. */
export function parseFindPhrase(param: string | string[] | undefined): string | null {
  const text = (Array.isArray(param) ? param[0] : param)?.trim();
  return text ? text.slice(0, MAX_PHRASE_CHARS) : null;
}

/**
 * Index in `words` of the first word of the first run matching `phrase`, comparing lowercase [a-z0-9] per word (quotes,
 * dashes and case differ between the stored quote and the book). Words that are only punctuation, like a spaced dash,
 * are skipped on both sides. Null when the phrase is empty or not there.
 */
export function findWordIndex(words: string[], phrase: string): number | null {
  const target = phrase.split(/\s+/).map(norm).filter(Boolean);
  if (target.length === 0) return null;
  const kept: { n: string; at: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    const n = norm(words[i]);
    if (n) kept.push({ n, at: i });
  }
  for (let i = 0; i + target.length <= kept.length; i++) {
    if (kept[i].n !== target[0]) continue;
    let j = 1;
    while (j < target.length && kept[i + j].n === target[j]) j++;
    if (j === target.length) return kept[i].at;
  }
  return null;
}
