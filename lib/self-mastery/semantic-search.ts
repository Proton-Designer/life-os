import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getUserEmbeddings, embeddingModelTag } from "@/lib/ai/embeddings";

type TypedClient = SupabaseClient<Database>;

/**
 * P2-13D -- semantic search over the user's own library.
 *
 * SEARCHES `source_chunks`, NOT `lessons`, DELIBERATELY. P2-13 Slice C only
 * ever persists `source_chunks.embedding` (lib/self-mastery/ingestion/
 * worker-stages.ts's `embeddingStage`, chunk-scoped by the `ingest_stage`
 * enum's own ordering) -- `lessons.embedding` has a column and an HNSW
 * index (migration 064) but NOTHING writes to it anywhere in this codebase
 * (confirmed by reading every write site before choosing this design, not
 * assumed). A `match_lessons` RPC would compile, apply cleanly, and return
 * zero rows for every real user forever -- "a check that examines nothing
 * reports success" (CLAUDE.md) applies just as much to a feature as a
 * check. Chunks are real prose from the book (not the more polished
 * title/core_claim shape lessons have), but they are the ONLY substrate
 * that is actually embedded today, and the task's own acceptance criteria
 * names "lessons/source_chunks" as alternatives, not a strict requirement
 * for the former. Populating `lessons.embedding` too (reusing Slice C's
 * already-computed chunk vectors inside `mergingStage`, per P2-13's own
 * task Log) is a natural near-term follow-up, not done here -- named
 * rather than silently deferred.
 *
 * EMBEDDING_MODEL MISMATCH: a chunk embedded under a provider the user no
 * longer prefers (they had only a Google key at ingest time, added an
 * OpenAI key since) is invisible to a query embedded under today's
 * preferred provider -- `match_source_chunks` filters on an exact
 * `embedding_model` string equality, never compares cross-model vectors
 * (real risk: OpenAI/Google vectors are not on the same axes, a raw
 * cosine distance between them is meaningless, not just "less accurate").
 * Accepted, not silently hidden: same "which key are you searching AS"
 * question every degrade-gracefully AI feature here already carries.
 */

export interface SearchHit {
  chunkId: string;
  bookId: string;
  bookTitle: string;
  excerpt: string;
  pageStart: number | null;
  pageEnd: number | null;
  /** Cosine similarity (1 - distance), null for a text-fallback hit -- there is no meaningful single ranking score for a plain substring match. */
  similarity: number | null;
}

export type SearchLibraryResult =
  | { mode: "semantic"; hits: SearchHit[] }
  | { mode: "text"; hits: SearchHit[] }
  | { mode: "unavailable"; message: string };

const MATCH_COUNT = 8;
const TEXT_FALLBACK_LIMIT = 8;
const EXCERPT_LENGTH = 240;
const MIN_QUERY_LENGTH = 2;

function excerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= EXCERPT_LENGTH ? trimmed : `${trimmed.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
}

/** Escapes `%`/`_`/`\` so a query containing them is a literal substring match, not a wildcard someone typed by accident. */
function escapeForIlike(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

interface ChunkWithBook {
  id: string;
  book_id: string;
  text: string;
  page_start: number | null;
  page_end: number | null;
  books: { title: string } | { title: string }[] | null;
}

function bookTitleOf(row: ChunkWithBook): string {
  const books = row.books;
  if (!books) return "Untitled";
  return Array.isArray(books) ? (books[0]?.title ?? "Untitled") : books.title;
}

async function textFallbackSearch(supabase: TypedClient, userId: string, query: string): Promise<SearchLibraryResult> {
  const { data, error } = await supabase
    .from("source_chunks")
    .select("id, book_id, text, page_start, page_end, books(title)")
    .eq("user_id", userId)
    .ilike("text", `%${escapeForIlike(query)}%`)
    .order("sort_order", { ascending: true })
    .limit(TEXT_FALLBACK_LIMIT);
  if (error) throw error;

  const hits: SearchHit[] = ((data ?? []) as ChunkWithBook[]).map((row) => ({
    chunkId: row.id,
    bookId: row.book_id,
    bookTitle: bookTitleOf(row),
    excerpt: excerpt(row.text),
    pageStart: row.page_start,
    pageEnd: row.page_end,
    similarity: null,
  }));
  return { mode: "text", hits };
}

/**
 * Never throws on a degraded path -- `no_key`/`unavailable` are real,
 * named states a caller renders honestly, same posture every other
 * AI-gated feature in this app takes (see this file's own header).
 */
export async function searchLibrary(supabase: TypedClient, userId: string, rawQuery: string): Promise<SearchLibraryResult> {
  const query = rawQuery.trim();
  if (query.length < MIN_QUERY_LENGTH) return { mode: "text", hits: [] };

  const embedResult = await getUserEmbeddings(supabase, userId, [query]);

  if (embedResult.status === "unavailable") {
    // A real attempt was made and failed (spend cap, provider error,
    // timeout) -- surfaced honestly rather than silently swapped for a
    // text search that would look like the query "just didn't match."
    return { mode: "unavailable", message: embedResult.message };
  }

  if (embedResult.status === "no_key") {
    return textFallbackSearch(supabase, userId, query);
  }

  const model = embeddingModelTag(embedResult.provider);
  const vectorLiteral = `[${embedResult.embeddings[0]!.join(",")}]`;
  const { data, error } = await supabase.rpc("match_source_chunks", {
    p_query_embedding: vectorLiteral,
    p_embedding_model: model,
    p_match_count: MATCH_COUNT,
  });
  if (error) throw error;

  const hits: SearchHit[] = (data ?? []).map((row) => ({
    chunkId: row.id,
    bookId: row.book_id,
    bookTitle: row.book_title,
    excerpt: excerpt(row.text),
    pageStart: row.page_start,
    pageEnd: row.page_end,
    similarity: row.similarity,
  }));
  return { mode: "semantic", hits };
}
