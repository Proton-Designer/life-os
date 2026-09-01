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
    case "generating_cards":
    case "finalizing":
      return "cards";
    case "done":
    case "failed":
      return "done";
  }
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
