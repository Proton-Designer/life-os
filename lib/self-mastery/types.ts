// Self-Mastery's own row/view types. The `books`/`lessons`/`cards`/
// `card_states`/`source_chunks` tables live only in the scratch DB right
// now (Lead: "I'll take the migrations to production with the next
// deploy") — lib/supabase/database.types.ts hasn't been regenerated
// against them yet, so queries against these tables can't lean on the
// generated `Database` type the way every other query in this repo does.
// These are hand-written to match the schema verified directly via psql
// against the scratch DB (`postgresql://postgres:scratch@localhost:55444/
// postgres`) — replace with generated types once Supabase regenerates
// them; the shapes below should match exactly, so that swap should be
// close to a no-op.

export type BookStatus = "uploading" | "processing" | "ready" | "failed";

export type IngestStage =
  | "queued"
  | "extracting_text"
  | "parsing_structure"
  | "chunking"
  | "embedding"
  | "extracting_lessons"
  | "merging"
  | "generating_cards"
  | "finalizing"
  | "done"
  | "failed";

// The DB enum, confirmed via \dT+ evidence_strength — NOT packages/design's
// stale "strong_research_base" spelling (ULM lead: type off the DB, don't
// inherit that drift).
export type EvidenceStrength = "author_anecdote" | "single_study" | "strong_research";

export type FsrsCardState = "new" | "learning" | "review" | "relearning";

export interface LibraryBook {
  id: string;
  title: string;
  author: string | null;
  status: BookStatus;
  stage: IngestStage;
  progressPct: number;
  lessonCount: number;
  coverHue: number | null;
  createdAt: string;
  readyAt: string | null;
  errorMessage: string | null;
  /** Mean FSRS retrievability across every card in the book, 0 if none reviewed yet. Never fabricated. */
  memoryStrength: number;
}

export interface LessonCardState {
  cardId: string;
  promptType: "free_recall" | "application" | "cloze" | "why";
  state: FsrsCardState;
  stability: number | null;
  lastReviewAt: string | null;
}

export interface BookDetailLesson {
  id: string;
  title: string;
  coreClaim: string | null;
  mechanism: string | null;
  actionTemplate: string | null;
  evidenceStrength: EvidenceStrength | null;
  provenanceQuote: string;
  pageRef: number | null;
  sourceChunkId: string | null;
  /** Mean FSRS retrievability across this lesson's own cards — same formula, same live data as the book-level number, just a narrower slice. */
  memoryStrength: number;
  cards: LessonCardState[];
}

export interface BookDetail {
  id: string;
  title: string;
  author: string | null;
  status: BookStatus;
  stage: IngestStage;
  progressPct: number;
  errorMessage: string | null;
  createdAt: string;
  readyAt: string | null;
  memoryStrength: number;
  lessons: BookDetailLesson[];
}
