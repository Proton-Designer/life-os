import type { ExtractedPage } from "./types";

const LIGATURES: Record<string, string> = {
  "ﬀ": "ff",
  "ﬁ": "fi",
  "ﬂ": "fl",
  "ﬃ": "ffi",
  "ﬄ": "ffl",
  "ﬅ": "st",
  "ﬆ": "st",
};

function collapseLigatures(text: string): string {
  return text.replace(/[ﬀ-ﬆ]/g, (m) => LIGATURES[m] ?? m);
}

/** Joins a word hyphenated across a line break: "exam-\nple" -> "example". */
function dehyphenate(text: string): string {
  return text.replace(/([a-z])-\n\s*([a-z])/g, "$1$2");
}

function normalizeLineForComparison(line: string): string {
  return line.trim().replace(/\s+/g, " ").replace(/\d+/g, "#").toLowerCase();
}

/**
 * Strips running headers/footers: a line recurring at the same position
 * (first or last line of a page) on >=60% of pages is chrome, not content.
 */
function stripRunningHeadersFooters(pages: ExtractedPage[]): ExtractedPage[] {
  if (pages.length < 5) return pages; // not enough pages for the pattern to be meaningful

  const firstLineCounts = new Map<string, number>();
  const lastLineCounts = new Map<string, number>();

  const firstLines: (string | null)[] = [];
  const lastLines: (string | null)[] = [];

  for (const p of pages) {
    const lines = p.text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const first = lines[0] ?? null;
    const last = lines.length > 1 ? (lines[lines.length - 1] ?? null) : null;
    firstLines.push(first);
    lastLines.push(last);
    if (first && first.length < 80) {
      const key = normalizeLineForComparison(first);
      firstLineCounts.set(key, (firstLineCounts.get(key) ?? 0) + 1);
    }
    if (last && last.length < 80) {
      const key = normalizeLineForComparison(last);
      lastLineCounts.set(key, (lastLineCounts.get(key) ?? 0) + 1);
    }
  }

  const threshold = Math.ceil(pages.length * 0.6);
  const chromeFirstLines = new Set(
    [...firstLineCounts.entries()].filter(([, c]) => c >= threshold).map(([k]) => k),
  );
  const chromeLastLines = new Set(
    [...lastLineCounts.entries()].filter(([, c]) => c >= threshold).map(([k]) => k),
  );

  if (chromeFirstLines.size === 0 && chromeLastLines.size === 0) return pages;

  return pages.map((p, i) => {
    const rawLines = p.text.split("\n");
    const trimmedLines = rawLines.map((l) => l.trim());
    let start = 0;
    let end = rawLines.length;

    const first = firstLines[i];
    if (first && chromeFirstLines.has(normalizeLineForComparison(first))) {
      const idx = trimmedLines.findIndex((l) => l.length > 0);
      if (idx >= 0) start = idx + 1;
    }
    const last = lastLines[i];
    if (last && chromeLastLines.has(normalizeLineForComparison(last))) {
      for (let j = rawLines.length - 1; j >= 0; j--) {
        if ((trimmedLines[j]?.length ?? 0) > 0) {
          end = j;
          break;
        }
      }
    }

    if (start === 0 && end === rawLines.length) return p;
    return { page: p.page, text: rawLines.slice(start, end).join("\n") };
  });
}

/**
 * ULM L6 §3 finding: Postgres rejects a NUL byte (U+0000) in a `text` column
 * outright (`22P05, "unsupported Unicode escape sequence"`) — a hard
 * data-type limitation, not a validation choice. A hostile or corrupted PDF
 * whose extracted text contains a NUL byte (plausible for scanned/garbled
 * content) would make every `source_chunks`/`book_sections`/`lessons`/`cards`
 * insert containing it fail identically, every time, and a naive retry-on-
 * error worker path would burn every attempt on the same poison pill before
 * landing on a generic failure message. Stripped here, once, at the source.
 */
function stripNulBytes(text: string): string {
  return text.replace(/\u0000/g, "");
}

/** Runs all extraction-artefact repairs in order. */
export function repairExtractedPages(pages: ExtractedPage[]): ExtractedPage[] {
  const withoutChrome = stripRunningHeadersFooters(pages);
  return withoutChrome.map((p) => ({
    page: p.page,
    text: stripNulBytes(dehyphenate(collapseLigatures(p.text))),
  }));
}
