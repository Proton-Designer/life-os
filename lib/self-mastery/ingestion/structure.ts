import type { DetectedSection, ExtractedPage, OutlineEntry } from "./types";

const CHAPTER_PATTERN = /^(chapter|part|section)\s+([ivxlcdm]+|\d+)\b/i;

/**
 * Exported so chunking/extraction can strip heading-like lines before
 * sentence-splitting — otherwise a heading with no terminal punctuation
 * (e.g. an all-caps chapter title running straight into the first
 * paragraph, common in real PDF text extraction) merges into the next
 * sentence and pollutes it as a lesson candidate.
 */
export function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  if (trimmed.endsWith(".")) return false;
  if (CHAPTER_PATTERN.test(trimmed)) return true;

  const words = trimmed.split(/\s+/);
  if (words.length === 0 || words.length > 12) return false;
  if (!/^[A-Z]/.test(trimmed)) return false;
  const capitalizedRatio = words.filter((w) => /^[A-Z]/.test(w)).length / words.length;
  return capitalizedRatio > 0.6;
}

/** Priority 1: the PDF's own outline/bookmarks. */
export function detectSectionsFromOutline(
  outline: OutlineEntry[],
  pages: ExtractedPage[],
): DetectedSection[] {
  const withPages = outline.filter(
    (o): o is OutlineEntry & { page: number } => o.page !== null,
  );
  if (withPages.length === 0) return [];

  const sorted = [...withPages].sort((a, b) => a.page - b.page);
  const lastPage = pages.at(-1)?.page ?? sorted.at(-1)!.page;

  return sorted.map((o, i) => {
    const next = sorted[i + 1];
    const pageEnd = next ? next.page - 1 : lastPage;
    return {
      title: o.title,
      sortOrder: i,
      pageStart: o.page,
      pageEnd: Math.max(pageEnd, o.page),
      level: o.level,
    };
  });
}

/**
 * Priority 2 fallback: candidate headings are short, standalone-looking
 * lines near the top of a page, matching chapter-ish patterns or a Title
 * Case profile.
 */
export function detectSectionsHeuristic(pages: ExtractedPage[]): DetectedSection[] {
  const candidates: { title: string; page: number }[] = [];

  for (const p of pages) {
    const lines = p.text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    for (const line of lines.slice(0, 3)) {
      if (looksLikeHeading(line)) {
        candidates.push({ title: line, page: p.page });
        break;
      }
    }
  }

  if (candidates.length === 0) return [];

  const lastPage = pages.at(-1)?.page ?? candidates.at(-1)!.page;
  return candidates.map((c, i) => {
    const next = candidates[i + 1];
    const pageEnd = next ? next.page - 1 : lastPage;
    return {
      title: c.title,
      sortOrder: i,
      pageStart: c.page,
      pageEnd: Math.max(pageEnd, c.page),
      level: 1,
    };
  });
}

/**
 * Structure is a nice-to-have, never a blocker: outline wins, heuristic is
 * the fallback, and a single section spanning the whole book is the last
 * resort so downstream chunking always has a section to align to.
 */
export function parseStructure(
  pages: ExtractedPage[],
  outline: OutlineEntry[] = [],
): DetectedSection[] {
  const fromOutline = detectSectionsFromOutline(outline, pages);
  if (fromOutline.length > 0) return fromOutline;

  const heuristic = detectSectionsHeuristic(pages);
  if (heuristic.length > 0) return heuristic;

  const first = pages[0]?.page ?? 1;
  const last = pages.at(-1)?.page ?? first;
  return [{ title: "Full Book", sortOrder: 0, pageStart: first, pageEnd: last, level: 1 }];
}

const SKIPPABLE_SECTION_TITLE =
  /^(index|bibliography|references|acknowledg(e)?ments|about the author|glossary|appendix|copyright|table of contents|contents|dedication)\b/i;

/** Front/back matter (copyright pages, indexes, bibliographies) produces
 * garbage lessons and is skipped by position via section classification. */
export function isSkippableSectionTitle(title: string): boolean {
  return SKIPPABLE_SECTION_TITLE.test(title.trim());
}
