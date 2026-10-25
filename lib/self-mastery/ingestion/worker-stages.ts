/**
 * Stage dispatch for the ingestion worker's per-chunk route handler (A5
 * gates 3-4, item 7b). One handler function per `ingest_stage`, generic
 * over stage per the Lead's explicit instruction: "build the handler
 * generic over stage rather than one handler per stage, and gate 4 becomes
 * configuration instead of a second implementation." This file is that
 * configuration table; app/api/self-mastery/ingestion/step/route.ts is the
 * one handler that reads it.
 *
 * Every `ingest_stage` has a handler below. `embedding` (P2-13 Slice C) was
 * the one exception until a real embedder existed (ADR-003/R43's local-
 * model deferral) -- `embeddingStage` now persists real BYOK embeddings
 * (`lib/ai/embeddings.ts`) into `source_chunks.embedding`, and
 * `chunkingStage` transitions into it instead of skipping straight to
 * `extracting_lessons`. A route hitting a genuinely unhandled stage still
 * returns 501 with the stage named, not a silent no-op -- that discipline
 * is unchanged, there's just nothing left to hit it.
 *
 * ⚠️ FAIL CLOSED WHEN NO REAL PROVIDER IS AVAILABLE — R43, and it reverses
 * this file's own earlier behaviour. The first version of this stage ran
 * `HeuristicProvider.checkEntailment` as a fallback when no real model was
 * configured, and recorded the attempt as a normal success. That was
 * wrong: `HeuristicProvider.checkEntailment` is trivially always SUPPORTS
 * by construction — it never actually evaluates the claim/quote pair — so
 * running it and marking the row is admitting an ungated lesson with an
 * asterisk. R12.3 already ruled the firewall's OTHER semantic arm (the
 * embedding-relevance floor) fails closed on unavailability rather than
 * degrading and annotating; this stage now matches that discipline rather
 * than being the one place the firewall quietly downgrades itself.
 *
 * PROVIDER SELECTION (Phase 1 item 3, 2026-09-13, superseding the version of
 * this comment that said "throws if no dev provider is configured"):
 * `resolveIngestionProvider()` below now ALWAYS returns something real to
 * call, ABSENCE NOT A GUARDED PRESENCE, same pattern as
 * `getDevProviderBaseUrl()`/`isIngestionAvailable()` elsewhere in this repo
 * -- dev keeps preferring `DevShimProvider` when `SELF_MASTERY_DEV_PROVIDER_URL`
 * is configured (and `NODE_ENV !== "production"`, checked inside
 * `getDevProviderBaseUrl()` itself); every other case (production, or dev
 * without a shim) falls through to the real, gateway-routed
 * `GatewayLlmProvider` instead. That one is provider-agnostic: it runs on whichever
 * provider (DeepSeek, Claude, OpenAI, Gemini, Kimi, Grok) the BOOK'S OWNER chose, on
 * the owner's own key (gateway.ts resolves it from the owner's saved preference). There is no longer a "no real provider at
 * all" branch to throw from at SELECTION time -- but the fail-closed
 * guarantee this comment describes is UNCHANGED, just relocated: a missing
 * key, a spend-cap refusal, or a genuine provider failure now throws from
 * INSIDE the call itself (`GatewayLlmProvider`'s `chatJson`, via
 * `gatewayChat`'s `ok:false` path) rather than from a pre-flight
 * `if (!provider)` check here. Either way, a stage that can't get a real
 * verdict/extraction/card set throws, `bracketStage` records a genuine
 * failure, and the chunk retries up to `max_attempts` -- it never silently
 * "passes."
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { DevShimProvider } from "./llm/dev-shim-provider";
import { GatewayLlmProvider, BATCH_SIZE_EXTRACT, BATCH_SIZE_CARDS } from "./llm/gateway-provider";
import { HeuristicProvider, type Embedder } from "./llm/heuristic-provider";
import type { CandidateLesson, GeneratedCard, EvidenceStrength } from "./llm/types";
import { getUserEmbeddings, embeddingModelTag } from "@/lib/ai/embeddings";
import { loadPdf, extractPages, extractOutline, EncryptedPdfError, UnreadablePdfError, TooManyPagesError } from "./pdf";
import { detectScannedPdf, MAX_PAGE_COUNT } from "./guards";
import { SCANNED_PDF_MESSAGE, ENCRYPTED_PDF_MESSAGE, UNREADABLE_PDF_MESSAGE, tooManyPagesMessage, EMPTY_DOCUMENT_MESSAGE, NOT_TEXT_MESSAGE, UNREADABLE_DOCUMENT_MESSAGE } from "./failure-messages";
import { extractTextDocument, isPagedSource, lessonSourceKind, TooManyPagesDocumentError } from "./documents";
import { ReaderImportError } from "@/lib/reader/import/errors";
import type { ExtractedPage, OutlineEntry } from "./types";
import { parseStructure } from "./structure";
import { chunkBook } from "./chunk";
import { computeTargetLessonCount } from "./merge";
import { buildSectionInsertPlan } from "./persist-sections";
import { repairExtractedPages } from "./text-repair";
import { applyExtractedLessons, applyGeneratedCards, applyEntailmentVerdict } from "./stage-apply";
import { notifyBookReady } from "@/lib/notifications/book-ready-notification";
import { gcBookPdfAfterIngestion } from "./book-pdf-gc";
import { buildReaderDocBeforeGc } from "@/lib/reader/server/best-effort";

type IngestStage = Database["public"]["Enums"]["ingest_stage"];
type IngestionJobRow = Database["public"]["Tables"]["ingestion_jobs"]["Row"];
const BOOKS_BUCKET = "books";

export interface StageWorkResult {
  tokensIn?: number;
  tokensOut?: number;
  /** Where the cursor should move on success. Same stage + chunkIndex+1 for "more chunks in this MAP stage"; the next stage + null for "this stage is done." */
  nextStage: IngestStage;
  nextChunkIndex: number | null;
}

export interface StageContext {
  job: IngestionJobRow;
  supabase: SupabaseClient<Database>;
}

export type StageHandler = (ctx: StageContext) => Promise<StageWorkResult>;

/**
 * The one place all three real-model stages (`extractingLessonsStage`,
 * `verifyGroundingStage`, `generatingCardsStage`) get their provider.
 * `DevShimProvider.fromEnv()` already IS the "dev only, absence not a
 * guarded presence" check (`getDevProviderBaseUrl()`'s own header): it
 * returns `null` in production (checked first, unconditionally) or when
 * `SELF_MASTERY_DEV_PROVIDER_URL` is unset, so this function does not
 * re-implement that gate -- it just says what to do on EITHER null case:
 * fall through to the real, gateway-routed, spend-capped `GatewayLlmProvider`,
 * using `ctx.job.user_id` (the book's owner, set by `set_user_id_from_book`
 * at job-creation time -- migration 074) so `gatewayChat` resolves that
 * user's own key for their chosen provider (there is no shared fallback
 * key any more), exactly like every other gateway caller.
 *
 * Typed as the concrete union, not the `LlmProvider` interface: both
 * concrete classes expose their own `lastUsage` (DevShimProvider's
 * long-standing convention; GatewayLlmProvider's new one, Phase 1 item 3) for
 * real-call telemetry, but `LlmProvider` itself declares no such member --
 * every call site below reads `provider.lastUsage` for `StageWorkResult`'s
 * `tokensIn`/`tokensOut`, which only typechecks against the union of the
 * two concrete classes, not the shared interface.
 */
function resolveIngestionProvider(ctx: StageContext): DevShimProvider | GatewayLlmProvider {
  return DevShimProvider.fromEnv() ?? new GatewayLlmProvider(ctx.supabase, ctx.job.user_id);
}

/**
 * P2-14: per-book batch-mode selector (migration 187, `books.ingestion_mode`).
 * Read fresh every invocation, never cached on `ctx.job` -- each stage
 * handler is its own HTTP request, and the column is a plain `text` CHECK,
 * not a Postgres enum, so the generated type is `string`; narrowed
 * defensively here rather than trusted verbatim -- anything other than the
 * literal `'batch'` degrades to `'standard'`, today's unchanged behavior,
 * never the other way around.
 */
/** Does this book have real page numbers? Only PDFs do (books.reader_source; null on rows from before it was set = a PDF). */
async function getBookIsPaged(ctx: StageContext): Promise<boolean> {
  const { data, error } = await ctx.supabase.from("books").select("reader_source").eq("id", ctx.job.book_id).single();
  if (error) throw error;
  return isPagedSource((data as { reader_source?: string | null } | null)?.reader_source);
}

async function getIngestionMode(ctx: StageContext): Promise<"standard" | "batch"> {
  const { data, error } = await ctx.supabase.from("books").select("ingestion_mode").eq("id", ctx.job.book_id).single();
  if (error) throw error;
  return data.ingestion_mode === "batch" ? "batch" : "standard";
}

/**
 * PERF-1 (2026-09-19, BRIEF-perf-concurrency.md): bounded concurrency for
 * the two per-item LLM stages below (`extractingLessonsStage`,
 * `generatingCardsStage` only -- NOT `mergingStage`/`verifyGroundingStage`,
 * which are whole-book/heuristic, not per-item LLM calls). Every concurrent
 * call sends the EXACT SAME prompt/tokens/model a sequential run would send
 * for that same chunk/lesson -- concurrency only overlaps independent
 * network calls already in flight; it never batches, merges, or changes
 * what gets asked. Only wall-clock changes, never cost or output
 * distribution (per the brief's own framing -- this is not a quality
 * tradeoff and must not become one).
 *
 * No documented DeepSeek rate limit exists anywhere in this repo (grepped
 * `lib/ai/**`, `docs/ai-connector/**` before picking this number) -- the
 * default below is a deliberately conservative guess, not a measured
 * ceiling, exactly as the brief allows when no documented limit can be
 * found. `1` reproduces today's exact sequential behavior (see each
 * stage's own fetch-branching below); tune via env with no redeploy.
 */
const DEFAULT_INGESTION_CONCURRENCY = 3;
function getIngestionConcurrency(): number {
  const raw = Number(process.env.SELF_MASTERY_INGESTION_CONCURRENCY ?? DEFAULT_INGESTION_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

/** Splits `items` into contiguous groups of at most `size` each, in order -- the tail group may be shorter. `size <= 1` is one item per group (used by standard mode, where each "unit of work" is a single chunk/lesson, same as batch mode's `BATCH_SIZE_*`-sized groups). */
function groupInOrder<T>(items: readonly T[], size: number): T[][] {
  if (size <= 1) return items.map((item) => [item]);
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

/**
 * Runs `fn` over `items` with at most `limit` in flight at once, returning
 * results in INPUT ORDER regardless of completion order.
 *
 * ORDER (the brief's own "most likely silent bug"): results are written by
 * INDEX (`results[i] = ...`), never by push -- push-order was the
 * pre-concurrency assumption `perChunkCandidates`/`perLessonCards` relied
 * on, and it silently breaks the moment two items can finish out of order.
 * `mapWithConcurrency` is the one place that reordering-under-concurrency
 * risk is handled; every caller gets back an array already in the order it
 * gave, with no ordering responsibility of its own.
 *
 * FAIL-CLOSED, NO PARTIAL RESULT: the first rejection stops every worker
 * from picking up a NEW item and this function rethrows that same error --
 * it never returns a partial array, so a caller cannot accidentally read
 * some-but-not-all results. This matches both stages' existing all-or-
 * nothing posture (their DB write loops only ever run after every model
 * call for the whole invocation has already succeeded) -- concurrency
 * changes how many items can be IN FLIGHT AT ONCE when one fails (up to
 * `limit - 1` siblings may already be mid-call and are left to finish
 * rather than cancelled -- there is no cancellation signal threaded through
 * `GatewayLlmProvider`/`gatewayChat`, and adding one is out of this task's
 * scope), but never changes whether a failure can produce a partial WRITE:
 * a sibling's already-in-flight result is computed and then discarded,
 * exactly like never having called `fn` on it, because this function never
 * returns from a failed call.
 */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let failure: { error: unknown } | undefined;

  async function worker(): Promise<void> {
    for (;;) {
      if (failure) return;
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i] as T, i);
      } catch (error) {
        failure ??= { error };
        return;
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (failure) throw failure.error;
  return results;
}

/**
 * `queued`/`extracting_text`/`parsing_structure`/`chunking` collapsed into
 * ONE handler, registered for all four `ingest_stage` values below. THE
 * REASON: those first three stages have no handler anywhere in this repo
 * today, and without one a real upload (which creates its `ingestion_jobs`
 * row at `stage='queued'` by default -- see `uploadBook` in
 * `self-mastery-actions.ts`) would 501 on its very first invocation, before
 * ever reaching `chunking`. They are also all fast, pure, deterministic CPU
 * work with zero model calls (PDF text extraction, outline/structure
 * detection, sentence-aware chunking) -- there is no benefit to splitting
 * them into separate resumable invocations the way a model-call-per-chunk
 * stage needs, and measured well under the 280s budget for any book under
 * `MAX_PAGE_COUNT`. This trades finer-grained resumability on this segment
 * for simplicity: a crash mid-invocation redoes PDF parsing from scratch on
 * retry, not partial chunking -- an explicit, deliberate scope decision,
 * not an oversight (flagged to the Lead when built, not discovered later).
 *
 * Whole-book (chunk_index null in, chunk_index 0 out into `embedding`, the next
 * stage). The embedding stage writes `source_chunks.embedding` only when the
 * owner has an embeddings-capable BYOK key (OpenAI/Google); without one it
 * writes nothing and the pipeline carries on (merge then cannot de-duplicate).
 *
 * IDEMPOTENT: delete-then-insert of this book's `source_chunks`, keyed by
 * `book_id` -- a retried attempt overwrites its own prior output rather
 * than duplicating it, per migration 109's own stated worker obligation.
 *
 * L9/R6: ALSO persists `book_sections` from `sections` and links
 * `source_chunks.section_id`, both new as of this pass. Not new work --
 * `parseStructure` (structure.ts) already ran on every ingest, already
 * decided chunk boundaries from it (`chunkBook` below), and until now
 * simply discarded the `DetectedSection[]` array afterward. This is
 * "persist what already exists," never a second extraction pass, and it
 * costs zero model calls (approved by the lead: no new job, no new
 * failure mode). Each chunk's own `sectionIndex` (chunk.ts) is the join
 * key back into `sections`, already carried through — no re-derivation.
 *
 * Section ids are generated CLIENT-SIDE (persist-sections.ts's
 * `buildSectionInsertPlan`), before either insert, so this function owns
 * the index -> id mapping outright rather than depending on PostgREST
 * returning inserted rows in insertion order, which is not a contract.
 * That mapping is a PURE function, deliberately factored out of this I/O
 * — tested directly (persist-sections.test.ts) without mocking Supabase,
 * PDF parsing, or Storage. Same idempotent delete-then-insert discipline
 * as `source_chunks`, and deliberately run FIRST: a re-chunk's fresh
 * `source_chunks` rows need real section ids to reference; the reverse
 * order would insert chunks with dangling references, if only for the
 * width of one function call.
 *
 * SCOPED TO FUTURE INGESTS ONLY, NOT A BACKFILL FOR EXISTING BOOKS --
 * measured, not assumed: the lead checked production directly. 13 books
 * have chunks; exactly 1 has a `file_path` (a real PDF ingest). The other
 * 12 are seeded starter-deck rows with no source file to re-download and
 * no outline to re-parse. A backfill would serve a population of one real
 * row, handleable by hand if it ever matters -- not worth the
 * re-download/page-range-matching machinery this file's own author
 * couldn't verify anyway (no Storage access from here).
 */
async function chunkingStage(ctx: StageContext): Promise<StageWorkResult> {
  const { data: book, error: bookError } = await ctx.supabase
    .from("books")
    .select("file_path")
    .eq("id", ctx.job.book_id)
    .single();
  if (bookError) throw bookError;
  if (!book.file_path) throw new Error(`chunking: book ${ctx.job.book_id} has no file_path -- nothing to chunk`);

  const { data: fileBlob, error: downloadError } = await ctx.supabase.storage
    .from(BOOKS_BUCKET)
    .download(book.file_path);
  if (downloadError) throw downloadError;

  // A problem with the FILE itself (password, damaged, too long, scanned) fails the same way every time, so it fails the
  // book now with a message that says what to do, instead of burning every retry and ending in "Something went wrong".
  const failBookForFile = async (message: string): Promise<StageWorkResult> => {
    const { error: fileFailError } = await ctx.supabase.from("books").update({ status: "failed", error_message: message }).eq("id", ctx.job.book_id);
    if (fileFailError) throw fileFailError;
    return { nextStage: "failed", nextChunkIndex: null };
  };

  // The stored file's extension says what it is (pdf for every book uploaded before EPUB/TXT/MD existed). PDFs keep the
  // exact path below; the text formats go through documents.ts, which hands back the same two things (numbered pages and a
  // page-based outline) so structure, chunking and every insert after this are shared.
  const kind = lessonSourceKind(book.file_path) ?? "pdf";
  const fileBytes = new Uint8Array(await fileBlob.arrayBuffer());
  let pages: ExtractedPage[];
  let outline: OutlineEntry[];
  if (kind === "pdf") {
    let pdf;
    let rawPages;
    try {
      pdf = await loadPdf(fileBytes);
      rawPages = await extractPages(pdf);
    } catch (e) {
      if (e instanceof EncryptedPdfError) return failBookForFile(ENCRYPTED_PDF_MESSAGE);
      if (e instanceof UnreadablePdfError) return failBookForFile(UNREADABLE_PDF_MESSAGE);
      if (e instanceof TooManyPagesError) return failBookForFile(tooManyPagesMessage(e.pageCount, MAX_PAGE_COUNT));
      throw e;
    }
    // text-repair.ts's own header (ULM L6 §3 finding): a NUL byte (U+0000) in
    // extracted PDF text makes Postgres reject the insert outright
    // ("unsupported Unicode escape sequence") on EVERY source_chunks/
    // book_sections/lessons/cards row that contains it, identically, every
    // retry -- a poison pill that burns all of max_attempts before failing.
    // `repairExtractedPages` was written and unit-tested for exactly this
    // (plus ligature/hyphenation cleanup) but had never actually been wired
    // into this real worker path -- confirmed live, running Phase 1 item 3's
    // real book, the first real PDF whose extracted text has ever reached
    // this INSERT. Applied here, once, before structure parsing and
    // chunking both see the same repaired text (so section titles/chunk text
    // stay consistent with each other, not repaired in one place and raw in
    // the other).
    pages = repairExtractedPages(rawPages);
    // A scanned/image-only PDF has no text layer, so every later stage would run on nothing and the book would only
    // fail at the very end ("couldn't find teachable lessons"). Stop here, once, saying what is wrong.
    if (detectScannedPdf(pages).isLikelyScanned) return failBookForFile(SCANNED_PDF_MESSAGE);
    outline = await extractOutline(pdf);
  } else {
    try {
      const doc = extractTextDocument(fileBytes, kind);
      pages = repairExtractedPages(doc.pages); // same NUL-byte poison-pill guard as PDF text
      outline = doc.outline;
    } catch (e) {
      if (e instanceof TooManyPagesDocumentError) return failBookForFile(tooManyPagesMessage(e.pageCount, MAX_PAGE_COUNT));
      if (e instanceof ReaderImportError) {
        if (e.code === "empty") return failBookForFile(EMPTY_DOCUMENT_MESSAGE);
        if (e.code === "unsupported_type") return failBookForFile(NOT_TEXT_MESSAGE);
        return failBookForFile(UNREADABLE_DOCUMENT_MESSAGE);
      }
      throw e;
    }
  }
  const sections = parseStructure(pages, outline);
  const chunks = chunkBook(pages, sections);

  // The index->id mapping and per-chunk section assignment are computed by
  // a pure function (persist-sections.ts), tested directly without any DB
  // mocking -- this is only the I/O around its output.
  const { sectionRows, chunkSectionIds } = buildSectionInsertPlan(sections, chunks);

  // book_sections, idempotent (delete-then-insert), run BEFORE
  // source_chunks below so this book's chunks can reference real section
  // ids. Deleting first is harmless even though old source_chunks rows
  // (not yet deleted) briefly lose their section_id to the FK's ON DELETE
  // SET NULL -- those rows are deleted in the very next step regardless.
  const { error: deleteSectionsError } = await ctx.supabase.from("book_sections").delete().eq("book_id", ctx.job.book_id);
  if (deleteSectionsError) throw deleteSectionsError;

  if (sectionRows.length > 0) {
    const { error: insertSectionsError } = await ctx.supabase.from("book_sections").insert(
      sectionRows.map((s) => ({
        id: s.id,
        book_id: ctx.job.book_id,
        // Trigger-derived (set_user_id_from_book, 062) -- overwritten
        // unconditionally before the row is stored; never read from here.
        user_id: "00000000-0000-0000-0000-000000000000",
        title: s.title,
        sort_order: s.sort_order,
        page_start: s.page_start,
        page_end: s.page_end,
        level: s.level,
      })),
    );
    if (insertSectionsError) throw insertSectionsError;
  }

  // Idempotent retry: clear this book's prior chunk rows before writing the
  // fresh set, rather than appending -- a redone attempt must produce the
  // same result, not a duplicated one.
  const { error: deleteError } = await ctx.supabase.from("source_chunks").delete().eq("book_id", ctx.job.book_id);
  if (deleteError) throw deleteError;

  if (chunks.length > 0) {
    const { error: insertError } = await ctx.supabase.from("source_chunks").insert(
      chunks.map((c, i) => ({
        book_id: ctx.job.book_id,
        // Trigger-derived (set_user_id_from_book, 063) -- overwritten
        // unconditionally before the row is stored; never read from here.
        user_id: "00000000-0000-0000-0000-000000000000",
        text: c.text,
        page_start: c.pageStart,
        page_end: c.pageEnd,
        token_count: c.tokenCount,
        sort_order: c.sortOrder,
        section_id: chunkSectionIds[i],
      })),
    );
    if (insertError) throw insertError;
  }

  // `page_count` feeds `computeTargetLessonCount` at the merging stage --
  // set here, once, from the real extraction result (the only point in the
  // pipeline that has it), not re-derived or guessed downstream.
  const { error: pageCountError } = await ctx.supabase
    .from("books")
    .update({ page_count: pages.length })
    .eq("id", ctx.job.book_id);
  if (pageCountError) throw pageCountError;

  return { nextStage: "embedding", nextChunkIndex: 0 };
}

/**
 * P2-13 Slice C: persist real embeddings for a book's chunks
 * (`source_chunks.embedding`/`embedding_model`, migrations 063/193).
 * CHUNK-scoped -- `IngestStage`'s own enum ordering places `embedding`
 * between `chunking` and `extracting_lessons`, before any `lessons` row
 * exists, so only `source_chunks` is touched here.
 *
 * Same MAP shape as `extractingLessonsStage`/`generatingCardsStage` (fetch
 * a bounded batch ordered by `sort_order`, advance the cursor by the
 * actual row count, exhausted when zero rows come back) -- deliberately
 * NOT "every un-embedded chunk in one call": a real book can have 200+
 * chunks (this run's own operator log records one at 201), and pushing
 * them all into a single embeddings request risks a provider's per-call
 * item limit or this route's own `maxDuration` for no reason -- embedding
 * is exactly as boundable as extraction/card-generation already are.
 * `EMBEDDING_BATCH_SIZE` is chosen conservatively: OpenAI's embeddings
 * endpoint documents up to 2048 inputs per request, but Google's
 * `batchEmbedContents` per-call ceiling was not stated plainly in the docs
 * fetched for Slice A -- 20 stays well under either plausible limit while
 * still cutting the call count meaningfully versus one chunk at a time.
 *
 * GRACEFUL DEGRADATION, same posture as `mergingStage`'s own `embed`
 * closure (Slice B): `no_key`/`unavailable` writes NOTHING for this batch
 * and the stage still advances -- embeddings are an enhancement (semantic
 * dedupe/search), never a pipeline gate. A provider success writes
 * `embedding` + `embedding_model` (`"provider:model"`, the SAME hardcoded
 * mapping `lib/ai/embeddings.ts`'s own `getUserEmbeddings` uses for its
 * usage-log entry, mirrored here since `GetUserEmbeddingsResult` doesn't
 * return a model string directly) per row.
 */
const EMBEDDING_BATCH_SIZE = 20;

async function embeddingStage(ctx: StageContext): Promise<StageWorkResult> {
  const chunkIndex = ctx.job.cursor_chunk_index ?? 0;

  const { data, error } = await ctx.supabase
    .from("source_chunks")
    .select("id, text")
    .eq("book_id", ctx.job.book_id)
    .order("sort_order", { ascending: true })
    .range(chunkIndex, chunkIndex + EMBEDDING_BATCH_SIZE - 1);
  if (error) throw error;
  const chunkRows = data ?? [];

  if (chunkRows.length === 0) {
    // MAP exhausted -- every chunk has been offered to embedding.
    return { nextStage: "extracting_lessons", nextChunkIndex: 0 };
  }

  const result = await getUserEmbeddings(
    ctx.supabase,
    ctx.job.user_id,
    chunkRows.map((c) => c.text),
  );
  if (result.status === "ok") {
    const model = embeddingModelTag(result.provider);
    for (let i = 0; i < chunkRows.length; i++) {
      const { error: updateError } = await ctx.supabase
        .from("source_chunks")
        .update({ embedding: `[${result.embeddings[i]!.join(",")}]`, embedding_model: model })
        .eq("id", chunkRows[i]!.id);
      if (updateError) throw updateError;
    }
  }
  // no_key/unavailable: write nothing for this batch, same graceful
  // degradation as Slice B -- this stage never blocks the pipeline.

  return { nextStage: "embedding", nextChunkIndex: chunkIndex + chunkRows.length };
}

/**
 * One `source_chunks` row per invocation, in `sort_order` -- same
 * deterministic-ordering-for-idempotent-retry reasoning as
 * `verifyGroundingStage` below. FAILS CLOSED on a provider failure (R43,
 * matching `verifyGroundingStage`'s own posture) -- extraction is
 * content-generation, not a firewall check, but this pipeline's entire
 * point is exercising real-model behaviour end to end; `HeuristicProvider`
 * is never in this call path at all (see `resolveIngestionProvider`).
 *
 * Write-time gates applied inside the active provider's own `extractLessons`
 * (`DevShimProvider` in dev, `GatewayLlmProvider` otherwise -- see
 * `resolveIngestionProvider`; grounding, language sanity, claim-not-quote,
 * ported identically into both) -- not duplicated here.
 * `passesTitleClaimRelevance` and the merge-time claim/provenance cosine
 * floor are NOT applied anywhere in this run (both need an embedding this
 * repo doesn't have -- the same ADR-003/R43 deferral `relevance_floor`,
 * migration 117, already records explicitly for the latter).
 *
 * Survivors land in `lessons` with `status: 'archived'`, `rank: null` --
 * the pre-selection holding state; `mergingStage` is what promotes a subset
 * to a real `rank`. IDEMPOTENT: delete-then-insert keyed by
 * `source_chunk_id` (scoped to `status='archived'` so a retry can never
 * touch a lesson some LATER stage already promoted -- impossible under
 * strictly-forward cursor advancement within one run, but scoped anyway
 * rather than relying on that).
 */
async function extractingLessonsStage(ctx: StageContext): Promise<StageWorkResult> {
  const chunkIndex = ctx.job.cursor_chunk_index ?? 0;
  const mode = await getIngestionMode(ctx);
  const batchSize = mode === "batch" ? BATCH_SIZE_EXTRACT : 1;
  const concurrency = getIngestionConcurrency();
  // An EPUB / TXT / Markdown book has no real pages: its lessons cite their section (in the prompt and in the data), and
  // page_ref is stored NULL rather than an internal coordinate dressed up as a page number.
  const paged = await getBookIsPaged(ctx);
  const sectionTitles = new Map<string, string>();
  if (!paged) {
    const { data: sectionRows, error: sectionsError } = await ctx.supabase.from("book_sections").select("id, title").eq("book_id", ctx.job.book_id);
    if (sectionsError) throw sectionsError;
    for (const row of sectionRows ?? []) sectionTitles.set(row.id as string, row.title as string);
  }

  // section_id selected alongside the rest (item 8): chunkingStage already
  // writes it onto every source_chunks row (see buildSectionInsertPlan
  // above) -- this stage just wasn't reading it back, so every lesson
  // extracted from a chunk lost its chapter/section provenance the moment
  // it was written, even though the FK to book_sections was there from
  // migration 064 onward.
  type ChunkRow = { id: string; text: string; page_start: number | null; page_end: number | null; section_id: string | null };
  let chunkRows: ChunkRow[];
  if (batchSize === 1 && concurrency === 1) {
    // EXACT original query/shape (standard mode, concurrency=1) --
    // byte-for-byte unchanged so an existing book's cost/call pattern never
    // moves when concurrency is left at its safest, most conservative
    // setting (PERF-1, 2026-09-19, BRIEF-perf-concurrency.md).
    const { data: chunkRow, error: chunkError } = await ctx.supabase
      .from("source_chunks")
      .select("id, text, page_start, page_end, section_id")
      .eq("book_id", ctx.job.book_id)
      .order("sort_order", { ascending: true })
      .range(chunkIndex, chunkIndex)
      .maybeSingle();
    if (chunkError) throw chunkError;
    chunkRows = chunkRow ? [chunkRow] : [];
  } else {
    // PERF-1: fetch up to `batchSize * concurrency` rows -- `concurrency`
    // independent calls in flight at once, each covering `batchSize` chunks
    // (1 in standard mode, BATCH_SIZE_EXTRACT in batch mode -- "in batch
    // mode each unit of work is already a 4-chunk combined call; run
    // several of THOSE concurrently", per the brief). At concurrency=1 this
    // range is identical to the pre-PERF-1 batch-mode fetch above (batchSize
    // * 1 = batchSize); only the array-vs-maybeSingle client-side shape
    // differs for standard mode, never the query itself.
    const { data, error: chunkError } = await ctx.supabase
      .from("source_chunks")
      .select("id, text, page_start, page_end, section_id")
      .eq("book_id", ctx.job.book_id)
      .order("sort_order", { ascending: true })
      .range(chunkIndex, chunkIndex + batchSize * concurrency - 1);
    if (chunkError) throw chunkError;
    chunkRows = data ?? [];
  }

  if (chunkRows.length === 0) {
    // MAP exhausted -- every chunk has been offered to extraction.
    return { nextStage: "merging", nextChunkIndex: null };
  }

  // PERF-1: one "unit of work" per group -- a lone chunk in standard mode, a
  // combined extractLessonsBatch call for up to BATCH_SIZE_EXTRACT chunks in
  // batch mode. Groups run with at most `concurrency` in flight at once;
  // mapWithConcurrency both bounds that and reassembles results back into
  // chunkRows' own order regardless of which group's call finishes first --
  // see that function's own header for why this is the part most likely to
  // go wrong. Each group gets its OWN provider instance (resolved inside
  // runExtractionGroup, not hoisted above this loop): GatewayLlmProvider/
  // DevShimProvider both report token usage via a single mutable
  // `lastUsage` field set by the most recently settled call, so two groups
  // sharing one instance while running concurrently could attribute one
  // group's tokens to another -- constructing fresh per group (cheap; both
  // classes are stateless besides `lastUsage`) makes that race impossible
  // rather than merely unlikely.
  async function runExtractionGroup(chunkGroup: ChunkRow[]): Promise<{ candidates: CandidateLesson[][]; tokensIn: number; tokensOut: number }> {
    const provider = resolveIngestionProvider(ctx);
    let tokensIn = 0;
    let tokensOut = 0;
    const recordUsage = () => {
      if (provider.lastUsage) {
        tokensIn += provider.lastUsage.promptTokens;
        tokensOut += provider.lastUsage.completionTokens;
      }
    };

    const groupInputs = chunkGroup.map((c) => ({
      chunkText: c.text,
      pageStart: c.page_start ?? 0,
      pageEnd: c.page_end ?? c.page_start ?? 0,
      ...(paged ? {} : { locationLabel: c.section_id && sectionTitles.has(c.section_id) ? `section "${sectionTitles.get(c.section_id)}"` : "a passage from the text" }),
      sourceChunkId: c.id,
    }));

    const groupCandidates: CandidateLesson[][] = [];
    if (batchSize > 1 && chunkGroup.length > 1 && provider instanceof GatewayLlmProvider) {
      // P2-14: ONE combined call for the whole group. A `null` slot (a
      // malformed or wrong-length response, per extractLessonsBatch's own
      // header) falls back to the single-item call for exactly that chunk --
      // never silently dropped. This fallback stays sequential within the
      // group -- only the space BETWEEN groups is where PERF-1 adds
      // concurrency, not within one already-batched call's own retry path.
      const batchResult = await provider.extractLessonsBatch(groupInputs);
      recordUsage();
      for (let i = 0; i < groupInputs.length; i++) {
        const result = batchResult.perChunk[i];
        if (result !== null && result !== undefined) {
          groupCandidates.push(result);
        } else {
          const single = await provider.extractLessons(groupInputs[i]!);
          recordUsage();
          groupCandidates.push(single);
        }
      }
    } else {
      // Standard mode (or a lone leftover chunk at the tail of a book) --
      // same one-call-per-chunk shape as before batch mode existed.
      for (const input of groupInputs) {
        const candidates = await provider.extractLessons(input);
        recordUsage();
        groupCandidates.push(candidates);
      }
    }
    return { candidates: groupCandidates, tokensIn, tokensOut };
  }

  const chunkGroups = groupInOrder(chunkRows, batchSize);
  const groupResults = await mapWithConcurrency(chunkGroups, concurrency, runExtractionGroup);
  // Flatten in chunkGroups' own order (mapWithConcurrency already restored
  // that), which is chunkRows' order, since chunkGroups is a contiguous,
  // in-order slicing of chunkRows -- see groupInOrder.
  const perChunkCandidates: CandidateLesson[][] = groupResults.flatMap((g) => g.candidates);
  const tokensIn = groupResults.reduce((sum, g) => sum + g.tokensIn, 0);
  const tokensOut = groupResults.reduce((sum, g) => sum + g.tokensOut, 0);

  for (let i = 0; i < chunkRows.length; i++) {
    const chunkRow = chunkRows[i]!;
    const candidates = perChunkCandidates[i]!;

    await applyExtractedLessons(ctx.supabase, { bookId: ctx.job.book_id, chunk: { id: chunkRow.id, sectionId: chunkRow.section_id }, candidates, paged });
  }

  return {
    nextStage: "extracting_lessons",
    nextChunkIndex: chunkIndex + chunkRows.length,
    tokensIn,
    tokensOut,
  };
}

/**
 * Whole-book. Selects the surviving lessons out of every `archived`
 * candidate `extractingLessonsStage` wrote, via `HeuristicProvider`'s
 * embedding-less `mergeLessons` path -- the Lead's own traced design
 * (`heuristic-provider.ts:217-219`: no `embed` function passed means every
 * candidate gets `embedding: []`, `cos([],[]) = 0 < 0.86`, so nothing
 * clusters). SELECTION works (top-N by `scoreActionability`, spread across
 * the book by page position); DEDUPLICATION does not -- near-duplicate
 * lessons survive as separate lessons. That is a defined, expected
 * degradation, not a bug: duplicates in item 7's output are the
 * degradation behaving as designed, not evidence extraction went wrong.
 *
 * IDEMPOTENT, but not by delete-then-insert (this stage doesn't insert
 * rows, it marks existing ones): a retried attempt first resets `rank` to
 * null for every lesson of this book before recomputing, so a crash after
 * partially assigning ranks on a prior attempt can never leave a stale
 * partial ranking mixed with a fresh one -- the recompute always starts
 * from the same "every archived candidate, no rank" input regardless of
 * how many prior attempts got partway through.
 */
async function mergingStage(ctx: StageContext): Promise<StageWorkResult> {
  const { error: resetError } = await ctx.supabase
    .from("lessons")
    .update({ rank: null })
    .eq("book_id", ctx.job.book_id)
    .eq("status", "archived");
  if (resetError) throw resetError;

  const { data: book, error: bookError } = await ctx.supabase
    .from("books")
    .select("page_count")
    .eq("id", ctx.job.book_id)
    .single();
  if (bookError) throw bookError;

  const { data: rows, error: rowsError } = await ctx.supabase
    .from("lessons")
    .select("id, title, core_claim, mechanism, action_template, evidence_strength, provenance_quote, page_ref, source_chunk_id")
    .eq("book_id", ctx.job.book_id)
    .eq("status", "archived");
  if (rowsError) throw rowsError;

  if (!rows || rows.length === 0) {
    // No surviving candidates at all -- a genuinely empty (or entirely
    // ungrounded) book. Nothing to rank; proceed anyway rather than fail,
    // matching merge.ts's own "left short rather than padded" posture.
    return { nextStage: "verifying_grounding", nextChunkIndex: 0 };
  }

  // A lesson from an EPUB / TXT / Markdown book has page_ref NULL (it has no real pages), but the merge spreads its picks across
  // the book by page position. Use the lesson's source chunk's own (internal, synthetic) page_start for that, so a long book
  // is not summarised from its first chapters only.
  const chunkPageById = new Map<string, number>();
  const needChunkPages = [...new Set(rows.filter((r) => r.page_ref === null && r.source_chunk_id).map((r) => r.source_chunk_id as string))];
  if (needChunkPages.length > 0) {
    const { data: chunkPages, error: chunkPagesError } = await ctx.supabase.from("source_chunks").select("id, page_start").in("id", needChunkPages);
    if (chunkPagesError) throw chunkPagesError;
    for (const c of chunkPages ?? []) if (c.page_start !== null) chunkPageById.set(c.id as string, c.page_start as number);
  }

  // Pair each row with a CandidateLesson so the merge algorithm's returned
  // survivors (which come back as CandidateLesson VALUES, not row ids --
  // llm/types.ts's interface has no id field) can be matched back to a
  // database row by object reference. clusterAndRank/HeuristicProvider both
  // preserve reference identity through the whole path -- verified by
  // reading merge.ts and heuristic-provider.ts, not assumed.
  const pairs: { id: string; candidate: CandidateLesson }[] = rows.map((r) => ({
    id: r.id,
    candidate: {
      title: r.title,
      coreClaim: r.core_claim ?? "",
      mechanism: r.mechanism ?? "",
      actionTemplate: r.action_template ?? "",
      evidenceStrength: r.evidence_strength ?? "author_anecdote",
      provenanceQuote: r.provenance_quote,
      pageRef: r.page_ref ?? (r.source_chunk_id ? chunkPageById.get(r.source_chunk_id) : undefined) ?? 0,
      sourceChunkId: r.source_chunk_id ?? "",
    },
  }));

  const targetCount = computeTargetLessonCount(book.page_count ?? pairs.length * 8);
  // P2-13: a REAL embedder when the user has an embeddings-capable key
  // (lib/ai/embeddings.ts, BYOK OpenAI/Google) -- degrades to the exact
  // SAME embedding-less behavior this file's own header already documents
  // ("DEDUPLICATION does not [work]... a defined, expected degradation")
  // on ANY failure (no key, monthly spend cap hit, provider error/timeout),
  // not just "no key" specifically: an ingestion job must never hard-fail
  // merely because embeddings hit a transient problem, the same
  // "degradation behaving as designed" posture this stage already commits
  // to for the pre-P2-13 no-embedder case.
  const embed: Embedder = async (texts) => {
    const result = await getUserEmbeddings(ctx.supabase, ctx.job.user_id, texts);
    return result.status === "ok" ? result.embeddings : texts.map(() => []);
  };
  const heuristic = new HeuristicProvider(embed);
  const survivors = await heuristic.mergeLessons({
    candidates: pairs.map((p) => p.candidate),
    targetCount: { min: targetCount, max: targetCount }, // merge.ts: a single target count, not a real range
  });

  const survivorIds = survivors.map((s) => {
    const pair = pairs.find((p) => p.candidate === s);
    if (!pair) throw new Error("mergingStage: a survivor returned by mergeLessons was not one of the input candidates -- reference identity broke");
    return pair.id;
  });

  for (let i = 0; i < survivorIds.length; i++) {
    const { error: rankError } = await ctx.supabase.from("lessons").update({ rank: i }).eq("id", survivorIds[i]!);
    if (rankError) throw rankError;
  }

  return { nextStage: "verifying_grounding", nextChunkIndex: 0 };
}

/**
 * One `rank`-ordered lesson per invocation. FAILS CLOSED on a provider
 * failure, same posture as `extractingLessonsStage` (see
 * `resolveIngestionProvider`). Card-text write-time gates (anti-leak,
 * language sanity, card-text sanity) run INSIDE the active provider's own
 * `generateCards`; not duplicated here.
 *
 * PROMOTION (D-018): a lesson whose surviving card count is zero must not
 * reach `status: 'active'` -- left at `'archived'`, still queryable for
 * diagnosis, never silently dropped. Decided per-lesson, immediately after
 * ITS OWN cards are generated, not deferred to a separate whole-book pass.
 *
 * IDEMPOTENT: delete-then-insert of this lesson's `cards`, keyed by
 * `lesson_id`.
 *
 * EVERY SURVIVING CARD ALSO GETS A `card_states` ROW HERE, in the same
 * invocation, immediately after it is created -- see the insert below for
 * why this is where that row is born, not a later whole-book sweep. A card
 * with no `card_states` row is invisible to `get_session_queue` forever
 * (both its arms select FROM card_states, never from cards): readable as
 * lesson content, never reachable as something to study.
 */
async function generatingCardsStage(ctx: StageContext): Promise<StageWorkResult> {
  const chunkIndex = ctx.job.cursor_chunk_index ?? 0;
  const mode = await getIngestionMode(ctx);
  const batchSize = mode === "batch" ? BATCH_SIZE_CARDS : 1;
  const concurrency = getIngestionConcurrency();

  type LessonRow = {
    id: string;
    title: string;
    core_claim: string | null;
    mechanism: string | null;
    action_template: string | null;
    evidence_strength: EvidenceStrength | null;
    provenance_quote: string;
    page_ref: number | null;
    source_chunk_id: string | null;
  };
  let lessonRows: LessonRow[];
  if (batchSize === 1 && concurrency === 1) {
    // EXACT original query/shape (standard mode, concurrency=1) --
    // byte-for-byte unchanged so an existing book's cost/call pattern never
    // moves when concurrency is left at its safest, most conservative
    // setting (PERF-1, 2026-09-19, BRIEF-perf-concurrency.md).
    const { data: lessonRow, error: lessonError } = await ctx.supabase
      .from("lessons")
      .select("id, title, core_claim, mechanism, action_template, evidence_strength, provenance_quote, page_ref, source_chunk_id")
      .eq("book_id", ctx.job.book_id)
      .not("rank", "is", null)
      .order("rank", { ascending: true })
      .range(chunkIndex, chunkIndex)
      .maybeSingle();
    if (lessonError) throw lessonError;
    lessonRows = lessonRow ? [lessonRow] : [];
  } else {
    // PERF-1: fetch up to `batchSize * concurrency` rank-ordered lessons --
    // `concurrency` independent calls in flight at once, each covering
    // `batchSize` lessons (1 in standard mode, BATCH_SIZE_CARDS in batch
    // mode). At concurrency=1 this range is identical to the pre-PERF-1
    // batch-mode fetch above (batchSize * 1 = batchSize); only the
    // array-vs-maybeSingle client-side shape differs for standard mode,
    // never the query itself.
    const { data, error: lessonError } = await ctx.supabase
      .from("lessons")
      .select("id, title, core_claim, mechanism, action_template, evidence_strength, provenance_quote, page_ref, source_chunk_id")
      .eq("book_id", ctx.job.book_id)
      .not("rank", "is", null)
      .order("rank", { ascending: true })
      .range(chunkIndex, chunkIndex + batchSize * concurrency - 1);
    if (lessonError) throw lessonError;
    lessonRows = data ?? [];
  }

  if (lessonRows.length === 0) {
    return { nextStage: "finalizing", nextChunkIndex: null };
  }

  // PERF-1: one "unit of work" per group -- a lone lesson in standard mode,
  // a combined generateCardsBatch call for up to BATCH_SIZE_CARDS lessons in
  // batch mode. See extractingLessonsStage's own PERF-1 comment (identical
  // reasoning, mirrored here) for why groups run through mapWithConcurrency
  // rather than a bare loop, and why each group resolves its own provider
  // instance instead of sharing one hoisted above this loop.
  async function runCardsGroup(lessonGroup: LessonRow[]): Promise<{ cards: GeneratedCard[][]; tokensIn: number; tokensOut: number }> {
    const provider = resolveIngestionProvider(ctx);
    let tokensIn = 0;
    let tokensOut = 0;
    const recordUsage = () => {
      if (provider.lastUsage) {
        tokensIn += provider.lastUsage.promptTokens;
        tokensOut += provider.lastUsage.completionTokens;
      }
    };

    const groupCandidates: CandidateLesson[] = lessonGroup.map((lessonRow) => ({
      title: lessonRow.title,
      coreClaim: lessonRow.core_claim ?? "",
      mechanism: lessonRow.mechanism ?? "",
      actionTemplate: lessonRow.action_template ?? "",
      evidenceStrength: lessonRow.evidence_strength ?? "author_anecdote",
      provenanceQuote: lessonRow.provenance_quote,
      pageRef: lessonRow.page_ref ?? 0,
      sourceChunkId: lessonRow.source_chunk_id ?? "",
    }));

    const groupCards: GeneratedCard[][] = [];
    if (batchSize > 1 && lessonGroup.length > 1 && provider instanceof GatewayLlmProvider) {
      // P2-14: ONE combined call for the whole group. A `null` slot falls
      // back to the single-item call (with its own free_recall/cloze
      // guarantee) for exactly that lesson -- never silently dropped. This
      // fallback stays sequential within the group, same reasoning as
      // extractingLessonsStage's own runExtractionGroup.
      const batchResult = await provider.generateCardsBatch(groupCandidates.map((lesson) => ({ lesson })));
      recordUsage();
      for (let i = 0; i < groupCandidates.length; i++) {
        const result = batchResult.perLesson[i];
        if (result !== null && result !== undefined) {
          groupCards.push(result);
        } else {
          const single = await provider.generateCards({ lesson: groupCandidates[i]! });
          recordUsage();
          groupCards.push(single);
        }
      }
    } else {
      // Standard mode (or a lone leftover lesson at the tail of a book) --
      // same one-call-per-lesson shape as before batch mode existed.
      for (const lesson of groupCandidates) {
        const cards = await provider.generateCards({ lesson });
        recordUsage();
        groupCards.push(cards);
      }
    }
    return { cards: groupCards, tokensIn, tokensOut };
  }

  const lessonGroups = groupInOrder(lessonRows, batchSize);
  const groupResults = await mapWithConcurrency(lessonGroups, concurrency, runCardsGroup);
  // Flatten in lessonGroups' own order (mapWithConcurrency already restored
  // that), which is lessonRows' order, since lessonGroups is a contiguous,
  // in-order slicing of lessonRows -- see groupInOrder.
  const perLessonCards: GeneratedCard[][] = groupResults.flatMap((g) => g.cards);
  const tokensIn = groupResults.reduce((sum, g) => sum + g.tokensIn, 0);
  const tokensOut = groupResults.reduce((sum, g) => sum + g.tokensOut, 0);

  for (let i = 0; i < lessonRows.length; i++) {
    const lessonRow = lessonRows[i]!;
    const cards = perLessonCards[i]!;

    await applyGeneratedCards(ctx.supabase, { userId: ctx.job.user_id, bookId: ctx.job.book_id, lessonId: lessonRow.id, cards });
  }

  return {
    nextStage: "generating_cards",
    nextChunkIndex: chunkIndex + lessonRows.length,
    tokensIn,
    tokensOut,
  };
}

/**
 * Whole-book, terminal bookkeeping. `books.status`/`ready_at`/
 * `progress_pct`/`lesson_count` are touched HERE and nowhere else in this
 * file -- deliberately: every earlier stage (including the already-accepted
 * `verifyGroundingStage`) leaves `books` alone, matching precedent, since
 * mid-run UI progress isn't this item's scope. Completion IS: a book that
 * finished ingesting must actually become visible/usable, which needs a
 * real `book_status` terminal value, not just an `ingestion_jobs.stage` no
 * one but the worker reads.
 *
 * ZERO SURVIVING LESSONS FAILS THE BOOK -- found by the Lead reading this
 * handler, not designed here originally: a book where every candidate was
 * rejected (empty source, or the firewall genuinely dropping everything)
 * must not read as `ready`/`progress_pct: 100`/`lesson_count: 0` -- that is
 * the emptiest possible success, on the exact run (item 7) whose purpose is
 * measuring whether the firewall actually drops anything. Ported behaviour,
 * not a new design choice: ULM's reference `apps/worker/src/pipeline.ts`
 * throws `HumanReadableFailure("We couldn't find teachable lessons in this
 * file.")` in this exact case, and it is a documented row in
 * `docs/specs/L2-ingestion.md`'s failure matrix (`ULM/docs/specs/
 * L2-ingestion.md:154`) -- carrying the same user-facing text forward.
 *
 * TERMINAL ON FIRST OCCURRENCE, NOT ROUTED THROUGH max_attempts: this
 * failure is deterministic, not transient -- a book that produced zero
 * teachable lessons will produce zero teachable lessons again on a retry of
 * the exact same source text, so consuming attempts against it before
 * failing would only delay an inevitable, identical outcome. Achieved by
 * NOT throwing: this returns a normal, successful StageWorkResult whose
 * `nextStage` is the terminal `'failed'` value -- the bracketed attempt
 * genuinely succeeded (it correctly finished deciding the book failed),
 * `advance_ingestion_cursor` moves `ingestion_jobs.stage` to `'failed'`
 * cleanly on the very first attempt, and gate 5's `cursor_attempt >=
 * max_attempts` codepath in route.ts (which only fires on a THROW) never
 * gets a chance to relitigate it.
 */
async function finalizingStage(ctx: StageContext): Promise<StageWorkResult> {
  const { count, error: countError } = await ctx.supabase
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .eq("book_id", ctx.job.book_id)
    .eq("status", "active");
  if (countError) throw countError;

  if (!count || count === 0) {
    const { error: failError } = await ctx.supabase
      .from("books")
      .update({ status: "failed", error_message: "We couldn't find teachable lessons in this file." })
      .eq("id", ctx.job.book_id);
    if (failError) throw failError;

    return { nextStage: "failed", nextChunkIndex: null };
  }

  const { data: readyBook, error: updateError } = await ctx.supabase
    .from("books")
    .update({ status: "ready", ready_at: new Date().toISOString(), progress_pct: 100, lesson_count: count })
    .eq("id", ctx.job.book_id)
    .select("file_path")
    .single();
  if (updateError) throw updateError;

  // #6: "your book is ready" push. NON-FATAL BY DESIGN (Opus Lead
  // requirement, 2026-09-14) -- a book becoming ready matters more than the
  // notification about it, so a push failure here must never fail or roll
  // back this stage. See lib/notifications/book-ready-notification.ts for
  // the claim-first exactly-once design (migration 177/178).
  try {
    await notifyBookReady(ctx.supabase, ctx.job.user_id, ctx.job.book_id);
  } catch (notifyError) {
    console.error(`notifyBookReady failed for book ${ctx.job.book_id}:`, notifyError);
  }

  // BRIEF-pdf-gc.md: the PDF is a transient input, not durable data --
  // reaching THIS branch (book.status just durably set to "ready") is the
  // pipeline's own genuinely terminal success state, well past chunking's
  // own retry window (see book-pdf-gc.ts's header for the full argument).
  // Never fatal to this stage -- see that file's own header.
  if (readyBook.file_path) {
    // Reader: build the focus-reader document from the PDF while it still exists. Best-effort and bounded
    // (best-effort.ts never throws and has a time budget); the try/catch is belt-and-braces so nothing here can
    // ever fail the ready transition or skip the GC below.
    try {
      await buildReaderDocBeforeGc(ctx.supabase, ctx.job.user_id, ctx.job.book_id);
    } catch (readerError) {
      console.error(`reader pre-GC build failed for book ${ctx.job.book_id}:`, readerError);
    }
    await gcBookPdfAfterIngestion(ctx.supabase, {
      bookId: ctx.job.book_id,
      userId: ctx.job.user_id,
      filePath: readyBook.file_path,
    });
  }

  return { nextStage: "done", nextChunkIndex: null };
}

async function verifyGroundingStage(ctx: StageContext): Promise<StageWorkResult> {
  const chunkIndex = ctx.job.cursor_chunk_index ?? 0;

  // One lesson per chunk_index ordinal, restricted to `rank is not null` --
  // FIX (found while scoping item 7's remaining handlers, applied now
  // rather than left for later per the Lead): without this filter, this
  // already-shipped stage iterates every `archived` candidate
  // `extractingLessonsStage` ever wrote, not just the subset `mergingStage`
  // actually selected -- wasted model spend on rejected candidates, and a
  // wrong denominator for item 7's entailment drop-rate prediction (12-ITEM-
  // 7-PREDICTION.md's §2a is a rate over merge-survivors, not over every
  // candidate that was ever extracted). Ordered by `rank` (not created_at/id
  // as before) so this stage and `generatingCardsStage` iterate the exact
  // same set in the exact same order -- both stages exist to walk the same
  // rank-ordered "lessons merging selected" sequence.
  const { data: lessons, error } = await ctx.supabase
    .from("lessons")
    .select("id, core_claim, provenance_quote")
    .eq("book_id", ctx.job.book_id)
    .not("rank", "is", null)
    .order("rank", { ascending: true });
  if (error) throw error;

  const lesson = lessons?.[chunkIndex];
  if (!lesson) {
    // No more lessons to verify at this book -- MAP phase for this stage
    // is exhausted. Advance to the next whole-book stage (chunk_index null).
    return { nextStage: "generating_cards", nextChunkIndex: null };
  }

  // FAIL CLOSED (R43) is enforced by `resolveIngestionProvider` + the
  // provider itself now, not by a pre-flight null check here: there is no
  // "no real provider" case left to guard against (dev shim, or
  // gateway-routed GatewayLlmProvider, always). What R43 actually forbids --
  // silently falling back to a trivially-always-SUPPORTS check -- still
  // cannot happen: `HeuristicProvider` is never in this call path at all.
  const provider = resolveIngestionProvider(ctx);

  // NOT wrapped in try/catch -- deliberately. If checkEntailment itself
  // throws (network error, malformed shim response, a real timeout), that
  // is the SAME fail-closed posture as the no-provider branch above: this
  // stage's own `throw` propagates to the caller's bracketStage, which
  // records a failed attempt; `cursor_chunk_index` is never advanced past
  // this lesson, so `claim_ingestion_job` retries the exact same lesson up
  // to max_attempts (gate 5) rather than this code guessing a verdict on
  // its behalf. A check that could not run must never be treated as though
  // it passed -- fail open here (assume SUPPORTS when the check errors)
  // is exactly the shape of bug this whole file exists to refuse; fail
  // closed by retrying (worst case, the book terminally fails after
  // max_attempts, same as any other stage failure) is the only posture
  // that can never let an unverified lesson through.
  const result = await provider.checkEntailment({
    claim: lesson.core_claim ?? "",
    quote: lesson.provenance_quote,
  });

  // ACT ON THE VERDICT (item 7). `checkEntailment` itself stays the pure,
  // stateless (claim, quote) -> verdict leaf types.ts documents -- this
  // stage is the "future worker" that interface's own comment names as
  // where verdict orchestration belongs, so acting here doesn't duplicate
  // or fight `isGrounded()` (grounding.ts): that function is a DIFFERENT,
  // independent hallucination-firewall arm -- a verbatim substring check
  // enforced write-time, inside every provider's own `extractLessons`,
  // before a candidate lesson ever reaches this table at all (see
  // grounding.ts's own header: "one of two independent enforcement
  // points"). By the time a lesson gets here it has ALREADY passed that
  // check; entailment is a second, later, semantic gate over lessons that
  // survived merge, catching what a substring match structurally cannot --
  // a quote that is present verbatim but does not actually support (or
  // actively contradicts) the claim built on top of it.
  //
  // R12.3's backfill-on-failure loop (retry the NEXT-ranked archived
  // candidate in a rejected lesson's place) stays explicitly out of scope
  // -- that is a bigger orchestration feature this item was never asked to
  // build, and the comment this replaces already flagged it as future
  // work. What WAS a bug: `void result;` discarded a real verdict instead
  // of acting on the one thing in scope -- keeping a lesson the check
  // found unsupported out of a user's hands. This is a learning product;
  // shipping a hallucinated lesson is its worst possible failure.
  //
  // D-018 PRECEDENT (generatingCardsStage below): a lesson that fails a
  // gate gets a RECOVERABLE status, never a delete. Same instinct here --
  // `rejected` (lesson_status, migration 060) has existed in the schema
  // since this table was created but no code path has ever written it
  // until now; it is exactly the "a real check disqualified this,
  // distinct from 'archived' meaning only 'the merge didn't pick it'"
  // state the schema already anticipated. `rank` is cleared alongside it
  // so the lesson drops out of BOTH this stage's own rank-ordered walk and
  // generatingCardsStage's identical one (both filter `.not("rank", "is",
  // null)`) -- the same mechanism that already excludes every candidate
  // mergingStage never selected, not a new exclusion path. Scoped to
  // `status: 'archived'` on the way out, matching every other targeted
  // write in this file (extractingLessonsStage's delete, mergingStage's
  // reset, generatingCardsStage's promote) rather than being the one write
  // that touches a row regardless of what state it's actually in.
  //
  // CONTRADICTS and UNRELATED are NOT the same severity, even though both
  // lead to the identical database action (rejected, unranked, never
  // reaches generating_cards): CONTRADICTS means the check found the quote
  // actively DISAGREES with the claim -- the specific hallucination shape
  // types.ts's own doc comment names as the reason this gate exists at all
  // ("verbatim grounding + cosine relevance both pass a quote that
  // CONTRADICTS its claim -- only meaning catches it"). UNRELATED means
  // the check could not CONFIRM support, without asserting the claim is
  // false -- a weaker, more ambiguous failure. Logged at different
  // severities so CONTRADICTS is the one that draws attention. A
  // persisted, queryable per-lesson reason (a real audit trail beyond a
  // log line) is a natural follow-up, not silently dropped -- it needs a
  // new column and therefore a migration number from the Lead, which is
  // out of this item's "surgically small" scope.
  await applyEntailmentVerdict(ctx.supabase, { lessonId: lesson.id, result });

  return {
    nextStage: "verifying_grounding",
    nextChunkIndex: chunkIndex + 1,
    tokensIn: provider.lastUsage?.promptTokens,
    tokensOut: provider.lastUsage?.completionTokens,
  };
}

export const STAGE_HANDLERS: Partial<Record<IngestStage, StageHandler>> = {
  queued: chunkingStage,
  extracting_text: chunkingStage,
  parsing_structure: chunkingStage,
  chunking: chunkingStage,
  embedding: embeddingStage,
  extracting_lessons: extractingLessonsStage,
  merging: mergingStage,
  verifying_grounding: verifyGroundingStage,
  generating_cards: generatingCardsStage,
  finalizing: finalizingStage,
};
