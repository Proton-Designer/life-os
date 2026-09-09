import { describe, expect, it } from "vitest";
import { buildSectionInsertPlan } from "../persist-sections";
import type { Chunk, DetectedSection } from "../types";

/**
 * L9/R6: the risky part of persisting `parseStructure`'s already-computed
 * output — the index→id mapping, and which chunk gets which section id —
 * proven here with no Supabase client, no PDF parsing, no Storage. See
 * worker-stages.ts's `chunkingStage` for the (thin, DB-only) glue this
 * feeds into.
 */

function section(overrides: Partial<DetectedSection> = {}): DetectedSection {
  return { title: "Chapter 1", sortOrder: 0, pageStart: 1, pageEnd: 10, level: 1, ...overrides };
}

function chunk(overrides: Partial<Chunk> = {}): Chunk {
  return { text: "text", pageStart: 1, pageEnd: 1, tokenCount: 10, sortOrder: 0, sectionIndex: null, ...overrides };
}

function idGenerator(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

describe("buildSectionInsertPlan", () => {
  it("assigns one freshly generated id per section, same order, and carries every section field through", () => {
    const sections = [
      section({ title: "Intro", sortOrder: 0, pageStart: 1, pageEnd: 5, level: 1 }),
      section({ title: "Chapter 1", sortOrder: 1, pageStart: 6, pageEnd: 20, level: 1 }),
    ];
    const plan = buildSectionInsertPlan(sections, [], idGenerator());

    expect(plan.sectionRows).toEqual([
      { id: "id-0", title: "Intro", sort_order: 0, page_start: 1, page_end: 5, level: 1 },
      { id: "id-1", title: "Chapter 1", sort_order: 1, page_start: 6, page_end: 20, level: 1 },
    ]);
  });

  it("maps each chunk's sectionIndex to that section's real id, in the chunk's own order", () => {
    const sections = [section({ title: "A" }), section({ title: "B" })];
    const chunks = [
      chunk({ sortOrder: 0, sectionIndex: 0 }),
      chunk({ sortOrder: 1, sectionIndex: 1 }),
      chunk({ sortOrder: 2, sectionIndex: 0 }), // a second chunk back in section A -- not required to be contiguous
    ];
    const plan = buildSectionInsertPlan(sections, chunks, idGenerator());

    expect(plan.chunkSectionIds).toEqual(["id-0", "id-1", "id-0"]);
  });

  it("a chunk with sectionIndex: null maps to null, never a fabricated id", () => {
    const plan = buildSectionInsertPlan([section()], [chunk({ sectionIndex: null })], idGenerator());
    expect(plan.chunkSectionIds).toEqual([null]);
  });

  it("a skippable section (front/back matter, dropped by chunkBook itself) still gets a book_sections row — it's real book structure, just with zero chunks referencing it", () => {
    const sections = [section({ title: "Bibliography", sortOrder: 0 }), section({ title: "Chapter 1", sortOrder: 1 })];
    // chunkBook never emits a chunk for a skippable section -- simulated
    // here by simply having no chunk reference index 0 at all.
    const chunks = [chunk({ sortOrder: 0, sectionIndex: 1 })];
    const plan = buildSectionInsertPlan(sections, chunks, idGenerator());

    expect(plan.sectionRows).toHaveLength(2);
    expect(plan.sectionRows[0]!.title).toBe("Bibliography");
    expect(plan.chunkSectionIds).toEqual(["id-1"]); // only the Chapter 1 id is ever used
  });

  it("the 'Full Book' single-section fallback (parseStructure's last resort) still maps every chunk to it", () => {
    const sections = [section({ title: "Full Book", sortOrder: 0, pageStart: 1, pageEnd: 300 })];
    const chunks = Array.from({ length: 5 }, (_, i) => chunk({ sortOrder: i, sectionIndex: 0 }));
    const plan = buildSectionInsertPlan(sections, chunks, idGenerator());

    expect(plan.sectionRows).toHaveLength(1);
    expect(plan.chunkSectionIds).toEqual(["id-0", "id-0", "id-0", "id-0", "id-0"]);
  });

  it("THROWS rather than silently mis-mapping when a chunk's sectionIndex is out of range for the given sections", () => {
    expect(() => buildSectionInsertPlan([section()], [chunk({ sectionIndex: 5 })], idGenerator())).toThrow(/sectionIndex 5.*only 1/i);
  });

  it("returns empty plans for a book with no detected sections and no chunks", () => {
    const plan = buildSectionInsertPlan([], [], idGenerator());
    expect(plan.sectionRows).toEqual([]);
    expect(plan.chunkSectionIds).toEqual([]);
  });

  it("uses a real crypto.randomUUID() by default, not a fixed/predictable id", () => {
    const plan = buildSectionInsertPlan([section(), section()], []);
    expect(plan.sectionRows[0]!.id).not.toBe(plan.sectionRows[1]!.id);
    expect(plan.sectionRows[0]!.id).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
