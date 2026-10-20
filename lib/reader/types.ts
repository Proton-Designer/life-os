// Shared contract for the Self-Mastery focus reader (server import pipeline ⇄ client reader).
// Positions and highlights are GLOBAL word indexes into a ReaderDoc; words come from
// tokenizeBlock() in ./tokenize, so server and client always agree on the index.

export const READER_DOC_VERSION = 1 as const;

export type ReaderSource = "pdf" | "epub" | "paste" | "text" | "url";

export type ReaderBlockKind = "p" | "h";

export interface ReaderBlock {
  kind: ReaderBlockKind;
  text: string;
  /** Global index of this block's first word. */
  firstWord: number;
}

export interface ReaderChapter {
  title: string;
  blockIndex: number;
  firstWord: number;
}

export interface ReaderDoc {
  version: typeof READER_DOC_VERSION;
  title: string;
  author: string | null;
  source: ReaderSource;
  sourceUrl: string | null;
  blocks: ReaderBlock[];
  chapters: ReaderChapter[];
  wordCount: number;
}

export type ReaderImportErrorCode =
  | "unsupported_type"
  | "too_large"
  | "encrypted_pdf"
  | "no_text"
  | "empty"
  | "fetch_failed"
  | "not_article"
  | "parse_failed";

export interface ReaderImportPreview {
  bookId: string;
  title: string;
  author: string | null;
  source: ReaderSource;
  wordCount: number;
  chapters: Pick<ReaderChapter, "title" | "firstWord">[];
  sample: string;
  warnings: string[];
}

export type ReaderTheme = "dark" | "light" | "sepia" | "contrast";

export interface ReaderSettings {
  wpm: number;
  fontScale: number;
  theme: ReaderTheme;
  voiceUri: string | null;
  speechRate: number;
  focalLines: boolean;
  dailyWordGoal: number | null;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  wpm: 300,
  fontScale: 1,
  theme: "dark",
  voiceUri: null,
  speechRate: 1,
  focalLines: true,
  dailyWordGoal: null,
};
