// Pure text cleanup shared by every importer. No I/O.

export interface RawBlock {
  kind: "p" | "h";
  text: string;
}

// Soft hyphen, zero-width space/non-joiner/joiner, word joiner, BOM, bidi marks.
const INVISIBLES = /[­​-‏⁠﻿‪-‮]/g;

/** Strip invisible characters, turn NBSP/odd spaces into spaces, collapse runs of whitespace. */
export function normalizeInline(s: string): string {
  return s
    .replace(INVISIBLES, "")
    .replace(/[  -   　\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same as normalizeInline but keeps line structure (for line-based processing). */
export function normalizeLines(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLES, "")
    .replace(/[  -   　\t]/g, " ")
    .split("\n")
    .map((l) => l.replace(/ +/g, " ").trim())
    .join("\n");
}

const HEADING_RE =
  /^(?:(?:chapter|part|book|section|act)\s+(?:\d{1,3}|[ivxlc]{1,7}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b[.:\- ]*.{0,70}|(?:prologue|epilogue|preface|foreword|introduction|afterword|conclusion|appendix(?:\s+[a-z0-9]+)?|acknowledg(?:e)?ments|contents|table of contents)\s*[.:]?)$/i;

export function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length <= 100 && HEADING_RE.test(t);
}

const TERMINAL = /[.!?:"”'’»)\]…]$/;

function isBarePageNumber(line: string): boolean {
  return /^(?:page\s+)?(?:\d{1,5}|[ivxlc]{1,7})(?:\s*(?:of|\/)\s*\d{1,5})?$/i.test(line.trim());
}

/** Key for "the same running header on different pages": digits collapse so "Chapter 3 | 12" ~ "Chapter 3 | 13". */
function headerKey(line: string): string {
  return line.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Drop running headers/footers (lines repeated, modulo digits, at the top/bottom of >= 30% of pages) and bare page
 * numbers at the top/bottom. Operates on per-page line arrays. Returns new arrays (same page count).
 */
export function stripPageFurniture(pages: string[][]): { pages: string[][]; removed: number } {
  const EDGE = 2;
  const nonEmptyIdx = (lines: string[]) => lines.map((l, i) => (l.length > 0 ? i : -1)).filter((i) => i >= 0);
  const counts = new Map<string, number>();
  const edgeOf = (lines: string[]) => {
    const idx = nonEmptyIdx(lines);
    return new Set([...idx.slice(0, EDGE), ...idx.slice(-EDGE)]);
  };
  for (const lines of pages) {
    const seen = new Set<string>();
    for (const i of edgeOf(lines)) {
      const k = headerKey(lines[i]);
      if (k.length > 0 && !seen.has(k)) {
        seen.add(k);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }
  // Need at least 3 pages for "repeated" to mean anything.
  const threshold = pages.length >= 3 ? Math.max(2, Math.ceil(pages.length * 0.3)) : Infinity;
  let removed = 0;
  const out = pages.map((lines) => {
    const edge = edgeOf(lines);
    return lines.filter((l, i) => {
      if (!edge.has(i) || l.length === 0) return true;
      const drop = isBarePageNumber(l) || (counts.get(headerKey(l)) ?? 0) >= threshold;
      if (drop) removed++;
      return !drop;
    });
  });
  return { pages: out, removed };
}

export interface FlattenResult {
  blocks: RawBlock[];
  /** For each input page, the index of the first block that starts on or after that page (clamped by the caller). */
  pageStartBlock: number[];
}

/**
 * Turn hard-wrapped lines (grouped by page; a plain text file is one "page") into paragraph/heading blocks:
 * join wrapped lines, de-hyphenate line-break hyphens, break on blank lines, on a short line that ends a sentence,
 * and around chapter-style headings. When the median line is long (> 110 chars) the text is not hard-wrapped, so
 * every line is its own paragraph.
 */
export function flattenLines(pages: string[][]): FlattenResult {
  const lens = pages.flat().filter((l) => l.length > 0).map((l) => l.length);
  const med = median(lens);
  const unwrapped = med > 110;
  const maxLen = lens.length ? Math.max(...lens.slice(0, 5000)) : 0;
  // A line "fills" the measure if it's close to the longest typical line; a short line ending a sentence is a paragraph end.
  const fullLen = Math.max(med, Math.min(maxLen, med * 1.25));

  const blocks: RawBlock[] = [];
  const pageStartBlock: number[] = [];
  let cur = "";
  let curLastLen = 0;

  const flush = () => {
    const t = normalizeInline(cur);
    if (t.length > 0) blocks.push({ kind: "p", text: t });
    cur = "";
    curLastLen = 0;
  };

  for (const lines of pages) {
    pageStartBlock.push(blocks.length + (cur.length > 0 ? 1 : 0));
    for (const raw of lines) {
      const line = raw.trim();
      if (line.length === 0) {
        flush();
        continue;
      }
      if (looksLikeHeading(line)) {
        flush();
        blocks.push({ kind: "h", text: normalizeInline(line) });
        continue;
      }
      if (cur.length === 0) {
        cur = line;
        curLastLen = line.length;
      } else if (/[A-Za-zÀ-ɏ]-$/.test(cur) && /^[a-zß-ÿ]/.test(line)) {
        // line-break hyphenation: "informa-" + "tion" -> "information"
        cur = cur.slice(0, -1) + line;
        curLastLen = line.length;
      } else {
        cur += " " + line;
        curLastLen = line.length;
      }
      const endsSentence = TERMINAL.test(cur.trim());
      if (unwrapped && endsSentence) flush();
      else if (!unwrapped && endsSentence && curLastLen < fullLen * 0.6) flush();
    }
  }
  flush();
  return { blocks, pageStartBlock };
}

/** Plain text (txt / paste): blank-line paragraphs when present, otherwise the PDF-style line joiner. */
export function textToBlocks(text: string): RawBlock[] {
  const norm = normalizeLines(text);
  if (/\n\s*\n/.test(norm)) {
    const out: RawBlock[] = [];
    for (const para of norm.split(/\n\s*\n+/)) {
      const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;
      if (lines.length === 1 && looksLikeHeading(lines[0])) {
        out.push({ kind: "h", text: lines[0] });
        continue;
      }
      // Within a paragraph: join, de-hyphenating.
      let joined = lines[0];
      for (const l of lines.slice(1)) {
        joined = /[A-Za-zÀ-ɏ]-$/.test(joined) && /^[a-zß-ÿ]/.test(l) ? joined.slice(0, -1) + l : joined + " " + l;
      }
      const t = normalizeInline(joined);
      if (t) out.push({ kind: "p", text: t });
    }
    return out;
  }
  return flattenLines([norm.split("\n")]).blocks;
}

/** Light Markdown -> blocks: headings keep their level, inline syntax is stripped, lists/quotes become paragraphs. */
export function markdownToBlocks(md: string): { blocks: RawBlock[]; headingLevels: number[] } {
  const lines = normalizeLines(md).split("\n");
  const blocks: RawBlock[] = [];
  const headingLevels: number[] = [];
  let para: string[] = [];
  let inFence = false;

  const inline = (s: string) =>
    s
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      .replace(/<https?:\/\/[^>]+>/g, "")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, "$2")
      .replace(/~~(.+?)~~/g, "$1");
  const flush = () => {
    const t = normalizeInline(inline(para.join(" ")));
    if (t) {
      blocks.push({ kind: "p", text: t });
      headingLevels.push(0);
    }
    para = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      if (line) para.push(line);
      continue;
    }
    if (line === "") {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (h) {
      flush();
      const t = normalizeInline(inline(h[2]));
      if (t) {
        blocks.push({ kind: "h", text: t });
        headingLevels.push(h[1].length);
      }
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(line) || /^[=-]{3,}$/.test(line)) {
      flush();
      continue;
    }
    // list marker / blockquote marker: each list item is its own paragraph
    const li = /^(?:[-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      para.push(li[1]);
      flush();
      continue;
    }
    para.push(line.replace(/^>\s?/, ""));
  }
  flush();
  return { blocks, headingLevels };
}
