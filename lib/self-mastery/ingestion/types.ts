/** Shared shapes threaded through the ingestion pipeline. Ported verbatim from
 * ULM's packages/core/src/ingestion/types.ts — pure, no I/O, no schema
 * dependency, nothing to adapt. */

export interface ExtractedPage {
  page: number;
  text: string;
}

export interface OutlineEntry {
  title: string;
  /** 1-indexed page number the outline entry points to, if resolvable. */
  page: number | null;
  level: number;
}

export interface DetectedSection {
  title: string;
  sortOrder: number;
  pageStart: number;
  pageEnd: number;
  level: number;
}

export interface Chunk {
  text: string;
  pageStart: number;
  pageEnd: number;
  tokenCount: number;
  sortOrder: number;
  /** Index into the DetectedSection[] array this chunk falls within, if any. */
  sectionIndex: number | null;
}
