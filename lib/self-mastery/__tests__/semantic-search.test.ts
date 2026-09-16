import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchLibrary } from "../semantic-search";

const getUserEmbeddingsMock = vi.fn();
vi.mock("@/lib/ai/embeddings", () => ({
  getUserEmbeddings: (...args: unknown[]) => getUserEmbeddingsMock(...args),
  embeddingModelTag: (provider: "openai" | "google") => `${provider}:${provider === "openai" ? "text-embedding-3-small" : "gemini-embedding-001"}`,
}));

type Call = { method: string; args: unknown[] };

function makeClient(opts: { textRows?: unknown[]; rpcRows?: unknown[]; rpcError?: unknown }) {
  const calls: Call[] = [];
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "ilike", "order", "limit"]) {
      chain[method] = vi.fn((...args: unknown[]) => {
        calls.push({ method, args });
        return chain;
      });
    }
    chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => resolve({ data: opts.textRows ?? [], error: null });
    return chain;
  });
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    calls.push({ method: `rpc:${fn}`, args: [args] });
    return Promise.resolve({ data: opts.rpcRows ?? [], error: opts.rpcError ?? null });
  });
  return { client: { from, rpc } as unknown as SupabaseClient, calls };
}

describe("searchLibrary", () => {
  it("a query shorter than 2 chars is a no-op, no embedding call, no DB hit", async () => {
    const { client } = makeClient({});
    const result = await searchLibrary(client, "u1", " a ");
    expect(result).toEqual({ mode: "text", hits: [] });
    expect(getUserEmbeddingsMock).not.toHaveBeenCalled();
  });

  it("no_key -- falls back to a real ILIKE text search over source_chunks, scoped to this user", async () => {
    getUserEmbeddingsMock.mockResolvedValueOnce({ status: "no_key" });
    const { client, calls } = makeClient({
      textRows: [{ id: "c1", book_id: "b1", text: "a claim about habits", page_start: 12, page_end: 13, books: { title: "Atomic Habits" } }],
    });
    const result = await searchLibrary(client, "u1", "habits");
    expect(result.mode).toBe("text");
    if (result.mode !== "text") throw new Error("expected text mode");
    expect(result.hits).toEqual([
      { chunkId: "c1", bookId: "b1", bookTitle: "Atomic Habits", excerpt: "a claim about habits", pageStart: 12, pageEnd: 13, similarity: null },
    ]);
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "user_id" && c.args[1] === "u1")).toBe(true);
    expect(calls.some((c) => c.method === "ilike" && c.args[0] === "text" && c.args[1] === "%habits%")).toBe(true);
  });

  it("no_key text fallback escapes % _ \\ so they are literal, not wildcards", async () => {
    getUserEmbeddingsMock.mockResolvedValueOnce({ status: "no_key" });
    const { client, calls } = makeClient({ textRows: [] });
    await searchLibrary(client, "u1", "50%_off\\deal");
    const ilikeCall = calls.find((c) => c.method === "ilike");
    expect(ilikeCall?.args[1]).toBe("%50\\%\\_off\\\\deal%");
  });

  it("a book relation the caller's RLS hides (soft-deleted) degrades to an honest 'Untitled' rather than throwing", async () => {
    getUserEmbeddingsMock.mockResolvedValueOnce({ status: "no_key" });
    const { client } = makeClient({ textRows: [{ id: "c1", book_id: "b1", text: "orphaned chunk", page_start: null, page_end: null, books: null }] });
    const result = await searchLibrary(client, "u1", "orphaned");
    if (result.mode !== "text") throw new Error("expected text mode");
    expect(result.hits[0]!.bookTitle).toBe("Untitled");
  });

  it("unavailable -- a real attempt failed, surfaced honestly, never silently swapped for a text result", async () => {
    getUserEmbeddingsMock.mockResolvedValueOnce({ status: "unavailable", message: "OpenAI rejected that key." });
    const { client, calls } = makeClient({});
    const result = await searchLibrary(client, "u1", "habits");
    expect(result).toEqual({ mode: "unavailable", message: "OpenAI rejected that key." });
    expect(calls.length).toBe(0); // never falls through to the text-search DB call
  });

  it("ok -- calls match_source_chunks with the query vector as a pgvector text literal and the provider's exact model tag", async () => {
    getUserEmbeddingsMock.mockResolvedValueOnce({ status: "ok", embeddings: [[0.1, 0.2, 0.3]], provider: "openai" });
    const { client, calls } = makeClient({
      rpcRows: [{ id: "c1", book_id: "b1", book_title: "Atomic Habits", text: "a claim about habits", page_start: 12, page_end: 13, similarity: 0.87 }],
    });
    const result = await searchLibrary(client, "u1", "habits");
    expect(result).toEqual({
      mode: "semantic",
      hits: [{ chunkId: "c1", bookId: "b1", bookTitle: "Atomic Habits", excerpt: "a claim about habits", pageStart: 12, pageEnd: 13, similarity: 0.87 }],
    });
    const rpcCall = calls.find((c) => c.method === "rpc:match_source_chunks");
    expect(rpcCall?.args[0]).toEqual({ p_query_embedding: "[0.1,0.2,0.3]", p_embedding_model: "openai:text-embedding-3-small", p_match_count: 8 });
  });

  it("ok with google provider tags the query with google's own model name, not openai's", async () => {
    getUserEmbeddingsMock.mockResolvedValueOnce({ status: "ok", embeddings: [[0.4]], provider: "google" });
    const { client, calls } = makeClient({ rpcRows: [] });
    await searchLibrary(client, "u1", "habits");
    const rpcCall = calls.find((c) => c.method === "rpc:match_source_chunks");
    expect((rpcCall?.args[0] as { p_embedding_model: string }).p_embedding_model).toBe("google:gemini-embedding-001");
  });

  it("a long chunk is truncated to a bounded excerpt with an ellipsis, not returned whole", async () => {
    getUserEmbeddingsMock.mockResolvedValueOnce({ status: "ok", embeddings: [[0.1]], provider: "openai" });
    const longText = "x".repeat(500);
    const { client } = makeClient({
      rpcRows: [{ id: "c1", book_id: "b1", book_title: "T", text: longText, page_start: null, page_end: null, similarity: 0.5 }],
    });
    const result = await searchLibrary(client, "u1", "habits");
    if (result.mode !== "semantic") throw new Error("expected semantic mode");
    expect(result.hits[0]!.excerpt.length).toBeLessThan(500);
    expect(result.hits[0]!.excerpt.endsWith("…")).toBe(true);
  });

  it("a DB error from the RPC throws rather than silently returning zero results", async () => {
    getUserEmbeddingsMock.mockResolvedValueOnce({ status: "ok", embeddings: [[0.1]], provider: "openai" });
    const { client } = makeClient({ rpcError: { message: "function match_source_chunks does not exist" } });
    await expect(searchLibrary(client, "u1", "habits")).rejects.toBeTruthy();
  });
});
