/**
 * Stage dispatch for the ingestion worker's per-chunk route handler (A5
 * gates 3-4, item 7b). One handler function per `ingest_stage`, generic
 * over stage per the Lead's explicit instruction: "build the handler
 * generic over stage rather than one handler per stage, and gate 4 becomes
 * configuration instead of a second implementation." This file is that
 * configuration table; app/api/self-mastery/ingestion/step/route.ts is the
 * one handler that reads it.
 *
 * Every `ingest_stage` except `embedding` has a handler below (`embedding`
 * is deliberately skipped -- no embedder exists in this repo, ADR-003/R43;
 * `chunkingStage` advances straight past it). A route hitting a genuinely
 * unhandled stage still returns 501 with the stage named, not a silent
 * no-op -- that discipline is unchanged, there's just nothing left to hit it.
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
 * than being the one place the firewall quietly downgrades itself. If
 * `getDevProviderBaseUrl()` (dev/shim) or a future funded provider isn't
 * available, this stage THROWS — the attempt records as a genuine failure
 * (bracketStage), the chunk retries, and it never silently "passes."
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { DevShimProvider } from "./llm/dev-shim-provider";
import { HeuristicProvider } from "./llm/heuristic-provider";
import type { CandidateLesson } from "./llm/types";
import { loadPdf, extractPages, extractOutline } from "./pdf";
import { parseStructure } from "./structure";
import { chunkBook } from "./chunk";
import { computeTargetLessonCount } from "./merge";

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
 * Whole-book (chunk_index null in, chunk_index 0 out into
 * `extracting_lessons` -- `embedding` is skipped entirely, same as
 * `merging`'s own embedding-less path: no embedder exists in this repo,
 * ADR-003/R43).
 *
 * IDEMPOTENT: delete-then-insert of this book's `source_chunks`, keyed by
 * `book_id` -- a retried attempt overwrites its own prior output rather
 * than duplicating it, per migration 109's own stated worker obligation.
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

  const pdf = await loadPdf(new Uint8Array(await fileBlob.arrayBuffer()));
  const pages = await extractPages(pdf);
  const outline = await extractOutline(pdf);
  const sections = parseStructure(pages, outline);
  const chunks = chunkBook(pages, sections);

  // Idempotent retry: clear this book's prior chunk rows before writing the
  // fresh set, rather than appending -- a redone attempt must produce the
  // same result, not a duplicated one.
  const { error: deleteError } = await ctx.supabase.from("source_chunks").delete().eq("book_id", ctx.job.book_id);
  if (deleteError) throw deleteError;

  if (chunks.length > 0) {
    const { error: insertError } = await ctx.supabase.from("source_chunks").insert(
      chunks.map((c) => ({
        book_id: ctx.job.book_id,
        // Trigger-derived (set_user_id_from_book, 063) -- overwritten
        // unconditionally before the row is stored; never read from here.
        user_id: "00000000-0000-0000-0000-000000000000",
        text: c.text,
        page_start: c.pageStart,
        page_end: c.pageEnd,
        token_count: c.tokenCount,
        sort_order: c.sortOrder,
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

  return { nextStage: "extracting_lessons", nextChunkIndex: 0 };
}

/**
 * One `source_chunks` row per invocation, in `sort_order` -- same
 * deterministic-ordering-for-idempotent-retry reasoning as
 * `verifyGroundingStage` below. FAILS CLOSED on no real provider (R43,
 * matching `verifyGroundingStage`'s own posture) -- extraction is
 * content-generation, not a firewall check, but item 7's entire point is
 * exercising real-model behaviour end to end; silently falling back to
 * `HeuristicProvider` here would defeat that without anyone deciding to.
 *
 * Write-time gates applied inside `DevShimProvider.extractLessons` itself
 * (grounding, language sanity, claim-not-quote) -- not duplicated here.
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

  const { data: chunkRow, error: chunkError } = await ctx.supabase
    .from("source_chunks")
    .select("id, text, page_start, page_end")
    .eq("book_id", ctx.job.book_id)
    .order("sort_order", { ascending: true })
    .range(chunkIndex, chunkIndex)
    .maybeSingle();
  if (chunkError) throw chunkError;

  if (!chunkRow) {
    // MAP exhausted -- every chunk has been offered to extraction.
    return { nextStage: "merging", nextChunkIndex: null };
  }

  const provider = DevShimProvider.fromEnv();
  if (!provider) {
    throw new Error(
      "extracting_lessons: no real extraction provider available (SELF_MASTERY_DEV_PROVIDER_URL unset, or NODE_ENV=production) -- refusing to silently degrade to HeuristicProvider for a run whose entire point is exercising real-model behaviour.",
    );
  }

  const candidates = await provider.extractLessons({
    chunkText: chunkRow.text,
    pageStart: chunkRow.page_start ?? 0,
    pageEnd: chunkRow.page_end ?? chunkRow.page_start ?? 0,
    sourceChunkId: chunkRow.id,
  });

  const { error: deleteError } = await ctx.supabase
    .from("lessons")
    .delete()
    .eq("source_chunk_id", chunkRow.id)
    .eq("status", "archived");
  if (deleteError) throw deleteError;

  if (candidates.length > 0) {
    const { error: insertError } = await ctx.supabase.from("lessons").insert(
      candidates.map((c) => ({
        book_id: ctx.job.book_id,
        user_id: "00000000-0000-0000-0000-000000000000", // trigger-derived (set_user_id_from_book, 064)
        source_chunk_id: c.sourceChunkId,
        title: c.title,
        core_claim: c.coreClaim,
        mechanism: c.mechanism,
        action_template: c.actionTemplate,
        evidence_strength: c.evidenceStrength,
        provenance_quote: c.provenanceQuote,
        page_ref: c.pageRef,
        status: "archived" as const,
        extracted_by: "model" as const, // 084: a real provider call, not the heuristic or seed paths
      })),
    );
    if (insertError) throw insertError;
  }

  return {
    nextStage: "extracting_lessons",
    nextChunkIndex: chunkIndex + 1,
    tokensIn: provider.lastUsage?.promptTokens,
    tokensOut: provider.lastUsage?.completionTokens,
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
      pageRef: r.page_ref ?? 0,
      sourceChunkId: r.source_chunk_id ?? "",
    },
  }));

  const targetCount = computeTargetLessonCount(book.page_count ?? pairs.length * 8);
  const heuristic = new HeuristicProvider(); // no `embed` -- the deliberate no-embedder path
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
 * One `rank`-ordered lesson per invocation. FAILS CLOSED on no real
 * provider, same posture as `extractingLessonsStage`. Card-text write-time
 * gates (anti-leak, language sanity, card-text sanity) run INSIDE
 * `DevShimProvider.generateCards` itself; not duplicated here.
 *
 * PROMOTION (D-018): a lesson whose surviving card count is zero must not
 * reach `status: 'active'` -- left at `'archived'`, still queryable for
 * diagnosis, never silently dropped. Decided per-lesson, immediately after
 * ITS OWN cards are generated, not deferred to a separate whole-book pass.
 *
 * IDEMPOTENT: delete-then-insert of this lesson's `cards`, keyed by
 * `lesson_id`.
 */
async function generatingCardsStage(ctx: StageContext): Promise<StageWorkResult> {
  const chunkIndex = ctx.job.cursor_chunk_index ?? 0;

  const { data: lessonRow, error: lessonError } = await ctx.supabase
    .from("lessons")
    .select("id, title, core_claim, mechanism, action_template, evidence_strength, provenance_quote, page_ref, source_chunk_id")
    .eq("book_id", ctx.job.book_id)
    .not("rank", "is", null)
    .order("rank", { ascending: true })
    .range(chunkIndex, chunkIndex)
    .maybeSingle();
  if (lessonError) throw lessonError;

  if (!lessonRow) {
    return { nextStage: "finalizing", nextChunkIndex: null };
  }

  const provider = DevShimProvider.fromEnv();
  if (!provider) {
    throw new Error(
      "generating_cards: no real card-generation provider available (SELF_MASTERY_DEV_PROVIDER_URL unset, or NODE_ENV=production) -- refusing to silently degrade to HeuristicProvider for a run whose entire point is exercising real-model behaviour.",
    );
  }

  const candidate: CandidateLesson = {
    title: lessonRow.title,
    coreClaim: lessonRow.core_claim ?? "",
    mechanism: lessonRow.mechanism ?? "",
    actionTemplate: lessonRow.action_template ?? "",
    evidenceStrength: lessonRow.evidence_strength ?? "author_anecdote",
    provenanceQuote: lessonRow.provenance_quote,
    pageRef: lessonRow.page_ref ?? 0,
    sourceChunkId: lessonRow.source_chunk_id ?? "",
  };
  const cards = await provider.generateCards({ lesson: candidate });

  const { error: deleteError } = await ctx.supabase.from("cards").delete().eq("lesson_id", lessonRow.id);
  if (deleteError) throw deleteError;

  if (cards.length > 0) {
    const { error: insertError } = await ctx.supabase.from("cards").insert(
      cards.map((c, i) => ({
        lesson_id: lessonRow.id,
        book_id: ctx.job.book_id,
        user_id: "00000000-0000-0000-0000-000000000000", // trigger-derived (set_user_id_from_book, 065)
        prompt_type: c.promptType,
        prompt: c.prompt,
        answer: c.answer,
        sort_order: i,
      })),
    );
    if (insertError) throw insertError;
  }

  // D-018: promote iff at least one card survived; a denied lesson keeps
  // its pre-promotion ('archived') status, never touched further here.
  if (cards.length > 0) {
    const { error: promoteError } = await ctx.supabase.from("lessons").update({ status: "active" }).eq("id", lessonRow.id);
    if (promoteError) throw promoteError;
  }

  return {
    nextStage: "generating_cards",
    nextChunkIndex: chunkIndex + 1,
    tokensIn: provider.lastUsage?.promptTokens,
    tokensOut: provider.lastUsage?.completionTokens,
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

  const { error: updateError } = await ctx.supabase
    .from("books")
    .update({ status: "ready", ready_at: new Date().toISOString(), progress_pct: 100, lesson_count: count })
    .eq("id", ctx.job.book_id);
  if (updateError) throw updateError;

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

  const provider = DevShimProvider.fromEnv();
  if (!provider) {
    // FAIL CLOSED (R43). No annotation, no fallback, no marked-pass with a
    // caveat -- an entailment check that cannot actually check must not
    // produce a row that looks like one that did. The chunk retries
    // (claim_ingestion_job) up to max_attempts (gate 5), same as any other
    // stage failure.
    throw new Error(
      "verifying_grounding: no real entailment provider available (SELF_MASTERY_DEV_PROVIDER_URL unset, or NODE_ENV=production) -- refusing to fall back to a trivially-always-SUPPORTS check.",
    );
  }

  const result = await provider.checkEntailment({
    claim: lesson.core_claim ?? "",
    quote: lesson.provenance_quote,
  });

  // R12.3's backfill-on-failure loop (retry the next-ranked archived
  // candidate) is worker ORCHESTRATION -- out of scope here per the same
  // boundary confirmed with ow9rlnds for checkEntailment itself. This
  // stage records the verdict via the caller's bracketStage/telemetry; it
  // does not act on a non-SUPPORTS verdict beyond that. Flagging rather
  // than silently dropping the requirement: a real backfill loop is future
  // work, not a gap this stage was ever scoped to close. Unlike the
  // no-provider case above, a CONTRADICTS/UNRELATED verdict from a REAL
  // check is a legitimate, meaningful result -- it is not this stage's job
  // to decide what happens next with it.
  void result;

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
  extracting_lessons: extractingLessonsStage,
  merging: mergingStage,
  verifying_grounding: verifyGroundingStage,
  generating_cards: generatingCardsStage,
  finalizing: finalizingStage,
};
