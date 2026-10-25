import type { IngestStage } from "./types";

// Collapses the worker's fine-grained ingest_stage into the small set a
// user should actually see named — mirrors ULM's own bucketFor/STAGE_LABEL
// (apps/web/src/app/(app)/books/[id]/page.tsx) exactly, since this is
// their established copy, not something to reinvent.
export const INGESTION_STAGE_ORDER = ["prep", "lessons", "cards", "done"] as const;
export type IngestionStageKey = (typeof INGESTION_STAGE_ORDER)[number];

export const INGESTION_STAGE_LABEL: Record<IngestionStageKey, string> = {
  prep: "Reading your book",
  lessons: "Finding lessons",
  cards: "Building your deck",
  done: "Ready",
};

export function bucketIngestStage(stage: IngestStage): IngestionStageKey {
  switch (stage) {
    case "queued":
    case "extracting_text":
    case "parsing_structure":
    case "chunking":
    case "embedding":
      return "prep";
    case "extracting_lessons":
      return "lessons";
    case "merging":
    // Sits between merging and generating_cards (migration 109) -- bucketed
    // with them rather than a fifth user-facing bucket of its own. Was
    // MISSING from this switch entirely until 2026-09-14 (S6): IngestStage
    // (types.ts) didn't list this value either, so TypeScript's exhaustiveness
    // check never caught it, and any book actually sitting in
    // verifying_grounding fell through this switch returning `undefined` at
    // runtime -- INGESTION_STAGE_LABEL[undefined] renders as nothing. Found
    // fixing the frozen-books.stage bug, not a hypothetical.
    case "verifying_grounding":
    case "generating_cards":
    case "finalizing":
      return "cards";
    case "done":
    case "failed":
      return "done";
  }
}

/**
 * What a processing book says about itself: the real stage name and the real percentage, e.g. "Finding lessons · 54%".
 * No percentage at 0 or when it is unknown, and never above 99 while the book is still processing (100 means "ready",
 * and the page shows that state itself).
 */
export function processingLabel(stage: IngestStage, progressPct: number): string {
  const label = INGESTION_STAGE_LABEL[bucketIngestStage(stage)];
  if (!Number.isFinite(progressPct) || progressPct <= 0) return label;
  return `${label} · ${Math.min(99, Math.round(progressPct))}%`;
}

// Same staleness classification ULM's book detail page uses — "never
// claimed" (no worker has picked this up), "genuinely slow" (still
// working), and "claimed but stalled" (stopped advancing) look identical
// to a naive progress display but mean different things, and only look
// different because of these thresholds.
export const NO_WORKER_THRESHOLD_MS = 2 * 60 * 1000;
export const STALLED_THRESHOLD_MS = 3 * 60 * 1000;

export function looksUnclaimed(stage: IngestStage, createdAt: Date, now: Date): boolean {
  return stage === "queued" && now.getTime() - createdAt.getTime() > NO_WORKER_THRESHOLD_MS;
}

/**
 * "Claimed, but stopped moving." Distinct from looksUnclaimed (never
 * picked up at all) and from ordinary in-progress (still advancing, just
 * slow — a real book spends real minutes per stage). STALLED_THRESHOLD_MS
 * existed as a defined constant since this file's creation but was never
 * read anywhere (S6, 2026-09-14) — there was no ingestion_jobs.updated_at
 * plumbed to a caller to compare it against. `jobUpdatedAt` is that
 * column: bumped by ingestion_jobs_touch_updated_at on every claim,
 * advance, or failure write, so its age IS the real "how long since
 * anything happened to this job" answer, not a proxy for it.
 *
 * `null` in (no ingestion_jobs row at all — a book that predates the
 * ingestion pipeline, e.g. a seeded starter deck) reads as "not stalled":
 * there is nothing to have stalled.
 */
export function looksStalled(stage: IngestStage, jobUpdatedAt: Date | null, now: Date): boolean {
  if (jobUpdatedAt === null) return false;
  if (stage === "queued" || stage === "done" || stage === "failed") return false;
  return now.getTime() - jobUpdatedAt.getTime() > STALLED_THRESHOLD_MS;
}
