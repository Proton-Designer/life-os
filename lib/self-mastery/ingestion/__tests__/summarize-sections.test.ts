import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { summarizeBookSections } from "../summarize-sections";
import { HeuristicProvider } from "../llm/heuristic-provider";
import type { LlmProvider } from "../llm/types";

/**
 * L9/R6's orchestration — proven end-to-end with `HeuristicProvider`
 * (deterministic, keyless), per the lead's own instruction: "prove the
 * parts you can with the heuristic provider, and say plainly which half is
 * unverified." What this suite proves: per-section batching bounded by the
 * chunk/char cap, provenance written accurately (only the chunks actually
 * sent), idempotent skip of already-summarized sections, per-section
 * failure isolation, and that a failed call never writes a placeholder.
 * What it does NOT and CANNOT prove: that a real DeepSeek call round-trips
 * correctly against production — see deepseek-provider.test.ts's own
 * header for that half.
 */

interface Section {
  id: string;
  title: string | null;
  sort_order: number;
  summary: string | null;
}
interface Chunk {
  id: string;
  text: string;
  sort_order: number;
}

function makeClient(opts: { book: { title: string }; sections: Section[]; chunksBySection: Record<string, Chunk[]> }) {
  const updates: { id: string; patch: Record<string, unknown> }[] = [];

  const from = vi.fn((table: string) => {
    if (table === "books") {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: opts.book, error: null }) }) }) };
    }
    if (table === "book_sections") {
      return {
        select: () => ({ eq: () => ({ order: async () => ({ data: opts.sections, error: null }) }) }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            updates.push({ id, patch });
            return { data: null, error: null };
          },
        }),
      };
    }
    if (table === "source_chunks") {
      return {
        select: () => ({
          eq: (_col: string, sectionId: string) => ({
            order: async () => ({ data: opts.chunksBySection[sectionId] ?? [], error: null }),
          }),
        }),
      };
    }
    throw new Error(`summarize-sections.test.ts mock: unexpected table "${table}"`);
  });

  return { client: { from } as unknown as SupabaseClient, updates };
}

function chunk(id: string, text: string, sortOrder: number): Chunk {
  return { id, text, sort_order: sortOrder };
}

/** A minimal fake satisfying `LlmProvider` for tests that only need to control `summarizeSection` — the other five methods are never called by `summarizeBookSections` and exist only to satisfy the type. */
function fakeProviderWith(summarizeSection: LlmProvider["summarizeSection"]): LlmProvider {
  const notCalled = () => {
    throw new Error("not expected to be called in this test");
  };
  return {
    triageChunk: notCalled,
    extractLessons: notCalled,
    mergeLessons: notCalled,
    generateCards: notCalled,
    gradeAnswer: notCalled,
    checkEntailment: notCalled,
    summarizeSection,
  };
}

describe("summarizeBookSections", () => {
  it("summarizes each section once, ordered by sort_order, and writes summary + full provenance", async () => {
    const sections: Section[] = [
      { id: "sec-1", title: "Chapter 1", sort_order: 0, summary: null },
      { id: "sec-2", title: "Chapter 2", sort_order: 1, summary: null },
    ];
    const chunksBySection: Record<string, Chunk[]> = {
      "sec-1": [chunk("c1", "Sentence one about chapter one.", 0), chunk("c2", "Sentence two about chapter one.", 1)],
      "sec-2": [chunk("c3", "Sentence one about chapter two.", 0)],
    };
    const { client, updates } = makeClient({ book: { title: "Atomic Habits" }, sections, chunksBySection });

    const outcomes = await summarizeBookSections(client, "book-1", new HeuristicProvider(), "heuristic", null);

    expect(outcomes).toEqual([
      { sectionId: "sec-1", status: "summarized", chunkIdsUsed: ["c1", "c2"] },
      { sectionId: "sec-2", status: "summarized", chunkIdsUsed: ["c3"] },
    ]);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ id: "sec-1", patch: { summarized_by: "heuristic", summary_model: null, summary_source_chunk_ids: ["c1", "c2"] } });
    expect(typeof updates[0]!.patch.summary).toBe("string");
    expect((updates[0]!.patch.summary as string).length).toBeGreaterThan(0);
    expect(typeof updates[0]!.patch.summarized_at).toBe("string");
  });

  it("skips a section that already has a summary, by default", async () => {
    const sections: Section[] = [{ id: "sec-1", title: "Chapter 1", sort_order: 0, summary: "Already done." }];
    const { client, updates } = makeClient({ book: { title: "B" }, sections, chunksBySection: { "sec-1": [chunk("c1", "text", 0)] } });

    const outcomes = await summarizeBookSections(client, "book-1", new HeuristicProvider(), "heuristic", null);

    expect(outcomes).toEqual([{ sectionId: "sec-1", status: "skipped_already_summarized" }]);
    expect(updates).toHaveLength(0);
  });

  it("re-summarizes an already-done section when force:true", async () => {
    const sections: Section[] = [{ id: "sec-1", title: "Chapter 1", sort_order: 0, summary: "Already done." }];
    const { client, updates } = makeClient({ book: { title: "B" }, sections, chunksBySection: { "sec-1": [chunk("c1", "New text to summarize.", 0)] } });

    const outcomes = await summarizeBookSections(client, "book-1", new HeuristicProvider(), "heuristic", null, { force: true });

    expect(outcomes).toEqual([{ sectionId: "sec-1", status: "summarized", chunkIdsUsed: ["c1"] }]);
    expect(updates).toHaveLength(1);
  });

  it("skips a section with zero linked chunks — nothing to summarize, not an error", async () => {
    const sections: Section[] = [{ id: "sec-1", title: "Empty section", sort_order: 0, summary: null }];
    const { client, updates } = makeClient({ book: { title: "B" }, sections, chunksBySection: {} });

    const outcomes = await summarizeBookSections(client, "book-1", new HeuristicProvider(), "heuristic", null);

    expect(outcomes).toEqual([{ sectionId: "sec-1", status: "skipped_no_chunks" }]);
    expect(updates).toHaveLength(0);
  });

  it("bounds a section's call to the chunk-count cap, in sort_order — never sends every chunk of an oversized (e.g. 'Full Book' fallback) section", async () => {
    const sections: Section[] = [{ id: "sec-1", title: "Full Book", sort_order: 0, summary: null }];
    // 12 chunks -- comfortably over the 8-chunk cap.
    const chunks = Array.from({ length: 12 }, (_, i) => chunk(`c${i}`, `Chunk number ${i}.`, i));
    const { client, updates } = makeClient({ book: { title: "B" }, sections, chunksBySection: { "sec-1": chunks } });

    const outcomes = await summarizeBookSections(client, "book-1", new HeuristicProvider(), "heuristic", null);

    expect(outcomes[0]!.status).toBe("summarized");
    expect(outcomes[0]!.chunkIdsUsed).toHaveLength(8);
    expect(outcomes[0]!.chunkIdsUsed).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"]); // first 8, in order -- never an arbitrary subset
    const provenance = updates[0]!.patch.summary_source_chunk_ids as string[];
    expect(provenance).toEqual(outcomes[0]!.chunkIdsUsed);
  });

  it("bounds a section's call to the character cap even with fewer than 8 chunks", async () => {
    const sections: Section[] = [{ id: "sec-1", title: "Huge chunks", sort_order: 0, summary: null }];
    const big = "x".repeat(15_000);
    const chunks = [chunk("c1", big, 0), chunk("c2", big, 1), chunk("c3", "small tail chunk", 2)];
    const { client } = makeClient({ book: { title: "B" }, sections, chunksBySection: { "sec-1": chunks } });

    const outcomes = await summarizeBookSections(client, "book-1", new HeuristicProvider(), "heuristic", null);

    // c1 alone (15,000 chars) fits under the 20,000 cap; c1+c2 (30,000)
    // would not, so the cap stops after c1 -- c2/c3 are never sent.
    expect(outcomes[0]!.chunkIdsUsed).toEqual(["c1"]);
  });

  it("isolates a per-section failure — one section's provider error doesn't abort the rest of the book, and writes nothing for it", async () => {
    const sections: Section[] = [
      { id: "sec-1", title: "Chapter 1", sort_order: 0, summary: null },
      { id: "sec-2", title: "Chapter 2", sort_order: 1, summary: null },
    ];
    const chunksBySection = { "sec-1": [chunk("c1", "text", 0)], "sec-2": [chunk("c2", "more text", 0)] };
    const { client, updates } = makeClient({ book: { title: "B" }, sections, chunksBySection });

    const failingProvider = fakeProviderWith(
      vi.fn(async (input) => {
        if (input.sectionTitle === "Chapter 1") throw new Error("provider outage");
        return { summary: "ok" };
      }),
    );

    const outcomes = await summarizeBookSections(client, "book-1", failingProvider, "model", "deepseek-v4-flash");

    expect(outcomes).toEqual([
      { sectionId: "sec-1", status: "failed", error: "provider outage" },
      { sectionId: "sec-2", status: "summarized", chunkIdsUsed: ["c2"] },
    ]);
    // The failed section wrote NOTHING -- only sec-2's update happened.
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe("sec-2");
  });

  it("passes the book title through to the provider", async () => {
    const sections: Section[] = [{ id: "sec-1", title: "Ch 1", sort_order: 0, summary: null }];
    const { client } = makeClient({ book: { title: "My Real Book Title" }, sections, chunksBySection: { "sec-1": [chunk("c1", "text", 0)] } });

    const summarizeSection = vi.fn(async () => ({ summary: "s" }));
    const fakeProvider = fakeProviderWith(summarizeSection);

    await summarizeBookSections(client, "book-1", fakeProvider, "model", "deepseek-v4-flash");

    expect(summarizeSection).toHaveBeenCalledWith(expect.objectContaining({ bookTitle: "My Real Book Title", sectionTitle: "Ch 1" }));
  });
});
