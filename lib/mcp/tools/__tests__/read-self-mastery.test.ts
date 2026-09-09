import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readTool } from "../read";
import { getDomain, getEntity } from "../../registry";

/**
 * The self_mastery domain expansion (books/book_sections/lessons/cards/
 * card_states/reviews/questions/self_explanations/lesson_promotions/
 * lesson_verdicts/sources), registered read-only. Two things this suite
 * exists specifically to prove, per the lead's explicit ask:
 *
 * 1. The raw-text exclusion survives the expansion — `source_chunks` stays
 *    structurally empty even with ten new sibling entities registered.
 * 2. `sources` (a table shared with CollegeOS via `kind`) never leaks a
 *    course-linked row through this domain's entity.
 */

function makeChain(opts: { single?: unknown; list?: unknown[]; count?: number; error?: unknown } = {}) {
  const eqCalls: [string, unknown][] = [];
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return chain;
  });
  chain.order = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: opts.single ?? null, error: opts.error ?? null }));
  chain.range = vi.fn(async () => ({ data: opts.list ?? [], error: opts.error ?? null, count: opts.count ?? (opts.list ?? []).length }));
  return { chain: chain as Record<string, ReturnType<typeof vi.fn>>, eqCalls };
}

function makeClient(opts: { single?: unknown; list?: unknown[]; count?: number; error?: unknown } = {}) {
  const { chain, eqCalls } = makeChain(opts);
  const from = vi.fn(() => chain);
  return { client: { from } as unknown as SupabaseClient, eqCalls };
}

describe("registry — self_mastery domain expansion is actually registered", () => {
  it("exposes every entity the lead asked for, plus the pre-existing source_chunks", () => {
    const domain = getDomain("self_mastery");
    expect(domain).toBeTruthy();
    expect(Object.keys(domain!.entities).sort()).toEqual(
      ["book", "book_section", "card", "card_state", "lesson", "lesson_promotion", "lesson_verdict", "question", "review", "self_explanation", "source", "source_chunks"].sort(),
    );
  });
});

describe("source_chunks stays structurally excluded after the expansion", () => {
  it("has an empty column allowlist regardless of everything else registered around it", () => {
    const def = getEntity("self_mastery", "source_chunks")!;
    expect(def.summaryColumns).toEqual([]);
    expect(def.fullColumns).toEqual([]);
  });

  it("REFUSES a fields request for .text or .embedding, same as before", async () => {
    const { client } = makeClient({ list: [] });
    await expect(
      readTool(client, "user-1", { domain: "self_mastery", entity: "source_chunks", detail: "full", fields: ["text"] }),
    ).rejects.toThrow(/not available for entity "source_chunks".*text/i);
    await expect(
      readTool(client, "user-1", { domain: "self_mastery", entity: "source_chunks", detail: "full", fields: ["embedding"] }),
    ).rejects.toThrow(/not available/i);
  });
});

describe("book — file_path/file_size_bytes excluded (a live pointer to the actual PDF)", () => {
  it("REFUSES a fields request for file_path", async () => {
    const { client } = makeClient({ list: [] });
    await expect(
      readTool(client, "user-1", { domain: "self_mastery", entity: "book", detail: "full", fields: ["file_path"] }),
    ).rejects.toThrow(/not available for entity "book".*file_path/i);
  });

  it("REFUSES a fields request for file_size_bytes too", async () => {
    const { client } = makeClient({ list: [] });
    await expect(
      readTool(client, "user-1", { domain: "self_mastery", entity: "book", detail: "full", fields: ["file_size_bytes"] }),
    ).rejects.toThrow(/not available/i);
  });

  it("full detail returns the metadata fields it DOES allow, and strips file_path/deleted_at even when the raw row carries them", async () => {
    // The raw row carries file_path/file_size_bytes/deleted_at deliberately
    // (as a real PostgREST response might, if a bug ever widened the
    // select) -- proving toItem() strips them because they're absent from
    // fullColumns, not merely because the fixture omitted them.
    const row = {
      id: "b1", title: "Atomic Habits", author: "James Clear", status: "ready", stage: "done", progress_pct: 100,
      page_count: 300, lesson_count: 12, error_message: null, cover_hue: 210, created_at: "2026-09-01T00:00:00Z",
      ready_at: "2026-09-01T01:00:00Z", deck_completed_at: null,
      file_path: "books/user-1/atomic-habits.pdf", file_size_bytes: 4_500_000, deleted_at: null,
    };
    const { client } = makeClient({ list: [row] });
    const outcome = await readTool(client, "user-1", { domain: "self_mastery", entity: "book", detail: "full" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const payload = JSON.parse(block.text);
    expect(payload.items[0]).toMatchObject({ id: "b1", title: "Atomic Habits", author: "James Clear" });
    expect(payload.items[0]).not.toHaveProperty("file_path");
    expect(payload.items[0]).not.toHaveProperty("file_size_bytes");
    expect(payload.items[0]).not.toHaveProperty("deleted_at");
  });
});

describe("questions.encrypted-style exclusions don't apply here, but the entity resolves and is filterable", () => {
  it("lists questions filtered by class_id and active", async () => {
    const row = { id: "q1", prompt: "What is X?", answer: "X is Y.", topic: "chapter 3", origin: "self", source_anchor: "p.42", source_skipped: false, active: true, class_id: "class-1", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" };
    const { client, eqCalls } = makeClient({ list: [row] });
    const outcome = await readTool(client, "user-1", {
      domain: "self_mastery",
      entity: "question",
      detail: "full",
      filter: { class_id: "class-1", active: true },
    });
    expect(eqCalls).toEqual(expect.arrayContaining([["class_id", "class-1"], ["active", true]]));
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text).items[0]).toMatchObject({ id: "q1", prompt: "What is X?" });
  });

  it("reports updated_at as null despite the row carrying a real updated_at value -- the lead's ruling: zero verified writers means a marker we can't trust, not one we assert anyway", async () => {
    const row = { id: "q1", prompt: "What is X?", answer: "X is Y.", topic: null, origin: "self", source_anchor: "p.42", source_skipped: false, active: true, class_id: "class-1", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-05T00:00:00Z" };
    const { client } = makeClient({ list: [row] });
    const outcome = await readTool(client, "user-1", { domain: "self_mastery", entity: "question", detail: "ids" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text).items[0]).toMatchObject({ id: "q1", updated_at: null });
  });
});

describe("sources — fixedFilter keeps CollegeOS's course-linked rows out of this entity", () => {
  it("always applies kind='book' on top of any caller filter, and never exposes class_id", async () => {
    // class_id included in the raw row (always null in reality under this
    // fixedFilter, but present here to prove toItem() actively strips it
    // rather than the fixture simply never having it).
    const row = { id: "s1", kind: "book", book_id: "book-1", class_id: null };
    const { client, eqCalls } = makeClient({ list: [row] });

    const outcome = await readTool(client, "user-1", { domain: "self_mastery", entity: "source", detail: "full", filter: { book_id: "book-1" } });

    expect(eqCalls).toEqual(expect.arrayContaining([["kind", "book"]]));
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const item = JSON.parse(block.text).items[0];
    expect(item).not.toHaveProperty("class_id");
  });

  it("REFUSES a fields request for class_id (never in fullColumns, guaranteed-null under the fixedFilter, excluded rather than left to mislead)", async () => {
    const { client } = makeClient({ list: [] });
    await expect(
      readTool(client, "user-1", { domain: "self_mastery", entity: "source", detail: "full", fields: ["class_id"] }),
    ).rejects.toThrow(/not available/i);
  });
});

describe("lesson — flat (not parent-scoped), per the owner's own ask to browse reflections across the whole library", () => {
  it("lists without requiring a book_id filter", async () => {
    const row = {
      id: "l1", title: "Habit stacking", core_claim: "Chain a new habit to an existing one.", mechanism: null,
      action_template: "After I pour my coffee, I will...", evidence_strength: "strong_research",
      provenance_quote: "Habit stacking is a strategy...", page_ref: 42, rank: 1, status: "active",
      relevance_floor: "passed", extracted_by: "ollama", book_id: "book-1", section_id: null, source_chunk_id: "chunk-1",
      created_at: "2026-09-01T00:00:00Z", embedding: "[0.1,0.2,0.3]",
    };
    const { client } = makeClient({ list: [row] });
    const outcome = await readTool(client, "user-1", { domain: "self_mastery", entity: "lesson", detail: "full" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const item = JSON.parse(block.text).items[0];
    expect(item).toMatchObject({ id: "l1", title: "Habit stacking" });
    // embedding is never selectable, regardless of detail
    expect(item).not.toHaveProperty("embedding");
  });

  it("narrows to one book via filter.book_id when asked, same column also usable on `card`", async () => {
    const { client, eqCalls } = makeClient({ list: [] });
    await readTool(client, "user-1", { domain: "self_mastery", entity: "lesson", filter: { book_id: "book-1" } });
    expect(eqCalls).toEqual(expect.arrayContaining([["book_id", "book-1"]]));
  });

  it("truncates provenance_quote to 240 chars + an ellipsis -- the lead's ruling: a citation must be citation-sized regardless of what any provider ever stores", async () => {
    const longQuote = "Q".repeat(500); // production measured a real 477-char outlier; 500 exercises the cap with room to spare
    const row = { id: "l2", title: "t", core_claim: null, provenance_quote: longQuote, book_id: "book-1", created_at: "2026-09-01T00:00:00Z" };
    const { client } = makeClient({ list: [row] });
    const outcome = await readTool(client, "user-1", { domain: "self_mastery", entity: "lesson", detail: "full" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const item = JSON.parse(block.text).items[0];
    expect(item.provenance_quote).toHaveLength(241); // 240 chars + the "…" marker
    expect(item.provenance_quote.endsWith("…")).toBe(true);
    expect(item.provenance_quote.slice(0, 240)).toBe("Q".repeat(240));
  });

  it("leaves a short (real-world-typical) provenance_quote untouched -- avg on production is 138 chars, well under the cap", async () => {
    const shortQuote = "Habit stacking is a strategy for building new habits by chaining them to existing ones.";
    const row = { id: "l3", title: "t", core_claim: null, provenance_quote: shortQuote, book_id: "book-1", created_at: "2026-09-01T00:00:00Z" };
    const { client } = makeClient({ list: [row] });
    const outcome = await readTool(client, "user-1", { domain: "self_mastery", entity: "lesson", detail: "full" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const item = JSON.parse(block.text).items[0];
    expect(item.provenance_quote).toBe(shortQuote);
  });
});

describe("book_section — parent-scoped (a section has no meaning outside its book)", () => {
  function makeParentAwareClient(opts: { parentRow?: { id: string } | null; childRows?: Record<string, unknown>[] }) {
    const from = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.order = vi.fn(() => chain);
      if (table === "books") {
        chain.maybeSingle = vi.fn(async () => ({ data: opts.parentRow ?? null, error: null }));
      } else {
        chain.range = vi.fn(async () => ({ data: opts.childRows ?? [], error: null, count: (opts.childRows ?? []).length }));
      }
      return chain;
    });
    return { from } as unknown as SupabaseClient;
  }

  it("REJECTS an unscoped list — no filter.book_id means no query at all", async () => {
    const client = makeParentAwareClient({ parentRow: { id: "book-1" } });
    await expect(readTool(client, "user-1", { domain: "self_mastery", entity: "book_section" })).rejects.toThrow(/requires filter\.book_id/i);
  });

  it("REJECTS when the named book doesn't belong to this user", async () => {
    const client = makeParentAwareClient({ parentRow: null });
    await expect(
      readTool(client, "user-1", { domain: "self_mastery", entity: "book_section", filter: { book_id: "someone-elses-book" } }),
    ).rejects.toThrow(/no parent books row/i);
  });

  it("ACCEPTS and lists once the parent book is verified owned", async () => {
    const client = makeParentAwareClient({
      parentRow: { id: "book-1" },
      childRows: [{ id: "sec-1", book_id: "book-1", title: "Chapter 1", sort_order: 0, page_start: 1, page_end: 20, level: 1 }],
    });
    const outcome = await readTool(client, "user-1", { domain: "self_mastery", entity: "book_section", filter: { book_id: "book-1" } });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text).items[0]).toMatchObject({ id: "sec-1", title: "Chapter 1" });
  });
});

describe("card_state / review — updated_at sourced from the right column", () => {
  it("card_state's updated_at is last_review_at, null on a never-reviewed row", async () => {
    const row = { id: "cs1", state: "new", due_at: null, stability: null, difficulty: null, reps: 0, lapses: 0, learning_steps: 0, last_review_at: null, last_rating: null, book_id: "book-1", card_id: "card-1", question_id: null };
    const { client } = makeClient({ list: [row] });
    const outcome = await readTool(client, "user-1", { domain: "self_mastery", entity: "card_state", detail: "ids" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text).items[0]).toMatchObject({ id: "cs1", updated_at: null });
  });

  it("review's updated_at is reviewed_at — the append-only log's one and only timestamp", async () => {
    const row = { id: "r1", rating: 3, reviewed_at: "2026-09-08T12:00:00Z", book_id: "book-1" };
    const { client } = makeClient({ list: [row] });
    const outcome = await readTool(client, "user-1", { domain: "self_mastery", entity: "review", detail: "ids" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text).items[0]).toMatchObject({ id: "r1", updated_at: "2026-09-08T12:00:00Z" });
  });
});
