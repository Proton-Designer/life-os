import type { Chunk, DetectedSection } from "./types";

/**
 * L9/R6's structural half: what to write to `book_sections`/
 * `source_chunks.section_id`, kept pure and separate from `worker-stages.ts`'s
 * DB I/O specifically so the risky part — the index→id mapping, and which
 * chunks get which section (or none) — is testable without mocking a
 * Supabase client, PDF parsing, or Storage at all.
 *
 * `sections`/`chunks` are exactly `parseStructure`/`chunkBook`'s own output
 * (structure.ts/chunk.ts) — this function persists what those already
 * compute, it does not re-derive anything. `chunk.sectionIndex` is the join
 * key back into `sections`, already carried through by `chunkBook`.
 */

export interface BookSectionRowForInsert {
  id: string;
  title: string | null;
  sort_order: number;
  page_start: number;
  page_end: number;
  level: number;
}

export interface SectionInsertPlan {
  /** One row per `sections[i]`, same order, ids freshly generated — never reused from a prior attempt (the caller deletes and re-inserts wholesale, same idempotent shape as source_chunks). */
  sectionRows: BookSectionRowForInsert[];
  /** Parallel to `chunks`, one entry per chunk — the section id to store on that chunk's `source_chunks.section_id`, or null for a chunk with no section (shouldn't occur in practice, since chunkBook only ever emits chunks scoped to a real section, but the type is honest about what `chunk.sectionIndex: number | null` actually allows). */
  chunkSectionIds: (string | null)[];
}

/**
 * `generateId` is injected (default `crypto.randomUUID`) so a test can pin
 * deterministic ids and assert the exact mapping, rather than asserting
 * "some string" and trusting the wiring.
 */
export function buildSectionInsertPlan(sections: DetectedSection[], chunks: Chunk[], generateId: () => string = () => crypto.randomUUID()): SectionInsertPlan {
  const sectionIds = sections.map(() => generateId());

  const sectionRows: BookSectionRowForInsert[] = sections.map((s, i) => ({
    id: sectionIds[i]!,
    title: s.title,
    sort_order: s.sortOrder,
    page_start: s.pageStart,
    page_end: s.pageEnd,
    level: s.level,
  }));

  const chunkSectionIds = chunks.map((c) => {
    if (c.sectionIndex === null) return null;
    const id = sectionIds[c.sectionIndex];
    // A chunk pointing past the end of `sections` would be a real bug in
    // chunkBook, not a case to paper over with a silent null — but this
    // function's own contract is "map what's given," so it fails loudly
    // rather than mis-attributing a chunk to the wrong section.
    if (id === undefined) {
      throw new Error(`buildSectionInsertPlan: chunk has sectionIndex ${c.sectionIndex}, but only ${sections.length} section(s) were given.`);
    }
    return id;
  });

  return { sectionRows, chunkSectionIds };
}
