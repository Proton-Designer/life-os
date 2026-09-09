import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmProvider } from "./llm/types";

/**
 * L9/R6's orchestration half — reads `book_sections`/`source_chunks`
 * (however they got there; this function doesn't care whether section
 * extraction ran today or a year ago), calls the provider ONCE PER SECTION,
 * never once per whole book (the owner's own words: "split it into
 * batches"), and writes `summary` + provenance.
 *
 * NEVER INVOKED AUTOMATICALLY. No route, no cron, no worker stage calls
 * this — the lead's explicit instruction: a background job that spends the
 * owner's metered DeepSeek credits without him asking is not a feature.
 * This is meant to be called by hand (a script today; a Settings action
 * the owner explicitly triggers later, out of scope here).
 *
 * Untyped `SupabaseClient`, not `SupabaseClient<Database>` — `book_sections`'
 * summary columns don't exist in the generated types until
 * docs/ai-connector/L9-migration-draft-book-sections-summary.sql is
 * applied, same posture as every other pre-migration table access in this
 * program (see lib/widgets/actions-core.ts's own header for the precedent).
 *
 * Per-section try/catch, deliberately: one section's call failing (a bad
 * key, a timeout, a provider outage) must not abort the rest of the book —
 * same "never let one bad row break the batch" posture as
 * lib/widgets/render.ts's `renderOne`.
 */

/**
 * A section-level cap, not a chunk-level one — bounded by BOTH a chunk-
 * count ceiling and a character ceiling, because either alone is easy to
 * defeat (a section with 3 enormous chunks, or 50 tiny ones). Chunks are
 * always taken in `sort_order`, so a truncated section always summarizes
 * its OWN beginning, never an arbitrary subset.
 *
 * KNOWN, ACKNOWLEDGED LIMITATION, not a silent one: `structure.ts`'s
 * `parseStructure` falls back to one "Full Book" section spanning the
 * entire book when no real chapter structure is detected at all. A book
 * that hits that fallback gets a summary of only its first ~20,000
 * characters (roughly the first two-three chunks), not the whole book —
 * this cap does not distinguish "a real, bounded chapter" from "the whole
 * book pretending to be one section." Flagged in the L9 report, not
 * discovered later.
 */
const MAX_CHUNKS_PER_SECTION_CALL = 8;
const MAX_CHARS_PER_SECTION_CALL = 20_000;

interface BookSectionRow {
  id: string;
  title: string | null;
  sort_order: number;
  summary: string | null;
}

interface SourceChunkRow {
  id: string;
  text: string;
  sort_order: number;
}

export interface SummarizeBookSectionsOptions {
  /** Re-summarize sections that already have a summary. Default false — idempotent by default, so re-running this doesn't re-spend credits on sections already done. */
  force?: boolean;
}

export interface SummarizeSectionOutcome {
  sectionId: string;
  status: "summarized" | "skipped_already_summarized" | "skipped_no_chunks" | "failed";
  /** Chunk ids actually sent to the provider — only set on `"summarized"`, and only ever the ones really included after the cap above. */
  chunkIdsUsed?: string[];
  error?: string;
}

export async function summarizeBookSections(
  supabase: SupabaseClient,
  bookId: string,
  provider: LlmProvider,
  /**
   * Which CLASS of generator `provider` is — mirrors `lessons.
   * extracted_by`'s own three values (084_ulm_lessons_extracted_by.sql).
   * `LlmProvider` has no way to self-report this (a provider instance
   * doesn't know its own provenance category), so the caller states it —
   * same reasoning that migration's header gives for keeping this a coarse
   * class, not a specific model name.
   */
  summarizedBy: "model" | "heuristic" | "seed",
  /** The specific model string for `summary_model` (e.g. "deepseek-v4-flash"). Null for a provider with no model name (HeuristicProvider). */
  summaryModel: string | null = null,
  opts: SummarizeBookSectionsOptions = {},
): Promise<SummarizeSectionOutcome[]> {
  const { data: book, error: bookError } = await supabase.from("books").select("title").eq("id", bookId).single();
  if (bookError) throw bookError;
  const bookTitle = (book as { title: string }).title;

  const { data: sectionRows, error: sectionsError } = await supabase
    .from("book_sections")
    .select("id, title, sort_order, summary")
    .eq("book_id", bookId)
    .order("sort_order", { ascending: true });
  if (sectionsError) throw sectionsError;
  const sections = (sectionRows ?? []) as unknown as BookSectionRow[];

  const outcomes: SummarizeSectionOutcome[] = [];

  for (const section of sections) {
    if (section.summary && !opts.force) {
      outcomes.push({ sectionId: section.id, status: "skipped_already_summarized" });
      continue;
    }

    const { data: chunkRows, error: chunksError } = await supabase
      .from("source_chunks")
      .select("id, text, sort_order")
      .eq("section_id", section.id)
      .order("sort_order", { ascending: true });
    if (chunksError) throw chunksError;
    const chunks = (chunkRows ?? []) as unknown as SourceChunkRow[];

    if (chunks.length === 0) {
      outcomes.push({ sectionId: section.id, status: "skipped_no_chunks" });
      continue;
    }

    const included: SourceChunkRow[] = [];
    let totalChars = 0;
    for (const c of chunks) {
      if (included.length >= MAX_CHUNKS_PER_SECTION_CALL) break;
      if (included.length > 0 && totalChars + c.text.length > MAX_CHARS_PER_SECTION_CALL) break;
      included.push(c);
      totalChars += c.text.length;
    }

    try {
      const { summary } = await provider.summarizeSection({
        bookTitle,
        sectionTitle: section.title ?? "Untitled section",
        chunkTexts: included.map((c) => c.text),
      });

      const chunkIdsUsed = included.map((c) => c.id);
      const { error: updateError } = await supabase
        .from("book_sections")
        .update({
          summary,
          summarized_by: summarizedBy,
          summary_model: summaryModel,
          summary_source_chunk_ids: chunkIdsUsed,
          summarized_at: new Date().toISOString(),
        })
        .eq("id", section.id);
      if (updateError) throw updateError;

      outcomes.push({ sectionId: section.id, status: "summarized", chunkIdsUsed });
    } catch (e) {
      // Deliberately does NOT write anything to this section's row — a
      // failed call must leave `summary`/`summarized_by` exactly as they
      // were (still null on a first attempt), never a partial or
      // placeholder value. The paired CHECK constraint in the migration
      // (summary/summarized_by must both be null or both be set) makes
      // that the schema's own guarantee, not just this function's care.
      outcomes.push({ sectionId: section.id, status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return outcomes;
}
