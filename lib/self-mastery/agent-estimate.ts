import { computeTargetLessonCount } from "@/lib/self-mastery/ingestion/merge";

/**
 * "About N steps" for a book that will be processed by the owner's connected agent (no AI key). Shown at upload, before the book has been read, so
 * it works from the file size only and is deliberately rough: the exact number appears on the book page once the book has been chunked.
 *
 * A step is one model call: one per chunk (extracting_lessons, ~12,000 characters a chunk: chunk.ts targets 3,000 tokens) plus two per selected
 * lesson (verifying_grounding, generating_cards); the pipeline selects pages/8 lessons, between 6 and 60 (merge.ts computeTargetLessonCount).
 */
export const AGENT_STEPS_PER_RUN = 30;
const CHARS_PER_CHUNK = 12_000;
const CHARS_PER_PAGE = 3_000;
/** Text PDFs run roughly 4 KB per page; EPUB (zipped HTML) holds about 1.5x its size in text. */
const PDF_BYTES_PER_PAGE = 4_000;
const EPUB_CHARS_PER_BYTE = 1.5;

export interface AgentEstimate {
  steps: number;
  runs: number;
}

export function estimateAgentSteps(file: { bytes: number; filename: string }): AgentEstimate {
  const name = file.filename.toLowerCase();
  let chars: number;
  let pages: number;
  if (name.endsWith(".pdf")) {
    pages = Math.max(1, file.bytes / PDF_BYTES_PER_PAGE);
    chars = pages * CHARS_PER_PAGE;
  } else {
    chars = name.endsWith(".epub") ? file.bytes * EPUB_CHARS_PER_BYTE : file.bytes;
    pages = Math.max(1, chars / CHARS_PER_PAGE);
  }
  const chunks = Math.max(1, Math.ceil(chars / CHARS_PER_CHUNK));
  const lessons = computeTargetLessonCount(pages);
  const raw = chunks + 2 * lessons;
  const steps = Math.max(10, Math.round(raw / 10) * 10);
  return { steps, runs: Math.max(1, Math.ceil(steps / AGENT_STEPS_PER_RUN)) };
}

export function agentEstimateMessage(e: AgentEstimate): string {
  return e.runs <= 1
    ? `About ${e.steps} steps; your agent does about ${AGENT_STEPS_PER_RUN} per run, so this should finish in one run.`
    : `About ${e.steps} steps; your agent does about ${AGENT_STEPS_PER_RUN} per run, so this finishes over about ${e.runs} runs.`;
}
