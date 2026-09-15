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
 * `DeepSeekProvider` instead. There is no longer a "no real provider at
 * all" branch to throw from at SELECTION time -- but the fail-closed
 * guarantee this comment describes is UNCHANGED, just relocated: a missing
 * key, a spend-cap refusal, or a genuine provider failure now throws from
 * INSIDE the call itself (`DeepSeekProvider`'s `chatJson`, via
 * `gatewayChat`'s `ok:false` path) rather than from a pre-flight
 * `if (!provider)` check here. Either way, a stage that can't get a real
 * verdict/extraction/card set throws, `bracketStage` records a genuine
 * failure, and the chunk retries up to `max_attempts` -- it never silently
 * "passes."
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { DevShimProvider } from "./llm/dev-shim-provider";
import { DeepSeekProvider } from "./llm/deepseek-provider";
import { HeuristicProvider } from "./llm/heuristic-provider";
import type { CandidateLesson } from "./llm/types";
import { loadPdf, extractPages, extractOutline } from "./pdf";
import { parseStructure } from "./structure";
import { chunkBook } from "./chunk";
import { computeTargetLessonCount } from "./merge";
import { buildSectionInsertPlan } from "./persist-sections";
import { repairExtractedPages } from "./text-repair";
import { notifyBookReady } from "@/lib/notifications/book-ready-notification";

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
 * fall through to the real, gateway-routed, spend-capped `DeepSeekProvider`,
 * using `ctx.job.user_id` (the book's owner, set by `set_user_id_from_book`
 * at job-creation time -- migration 074) so `gatewayChat` resolves that
 * user's own key first, the shared operator-funded `DEEPSEEK_API_KEY`
 * otherwise, exactly like every other gateway caller.
 *
 * Typed as the concrete union, not the `LlmProvider` interface: both
 * concrete classes expose their own `lastUsage` (DevShimProvider's
 * long-standing convention; DeepSeekProvider's new one, Phase 1 item 3) for
 * real-call telemetry, but `LlmProvider` itself declares no such member --
 * every call site below reads `provider.lastUsage` for `StageWorkResult`'s
 * `tokensIn`/`tokensOut`, which only typechecks against the union of the
 * two concrete classes, not the shared interface.
 */
function resolveIngestionProvider(ctx: StageContext): DevShimProvider | DeepSeekProvider {
  return DevShimProvider.fromEnv() ?? new DeepSeekProvider(ctx.supabase, ctx.job.user_id);
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
 * Whole-book (chunk_index null in, chunk_index 0 out into
 * `extracting_lessons` -- `embedding` is skipped entirely, same as
 * `merging`'s own embedding-less path: no embedder exists in this repo,
 * ADR-003/R43).
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

  const pdf = await loadPdf(new Uint8Array(await fileBlob.arrayBuffer()));
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
  const pages = repairExtractedPages(await extractPages(pdf));
  const outline = await extractOutline(pdf);
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

  return { nextStage: "extracting_lessons", nextChunkIndex: 0 };
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
 * (`DevShimProvider` in dev, `DeepSeekProvider` otherwise -- see
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

  // section_id selected alongside the rest (item 8): chunkingStage already
  // writes it onto every source_chunks row (see buildSectionInsertPlan
  // above) -- this stage just wasn't reading it back, so every lesson
  // extracted from a chunk lost its chapter/section provenance the moment
  // it was written, even though the FK to book_sections was there from
  // migration 064 onward.
  const { data: chunkRow, error: chunkError } = await ctx.supabase
    .from("source_chunks")
    .select("id, text, page_start, page_end, section_id")
    .eq("book_id", ctx.job.book_id)
    .order("sort_order", { ascending: true })
    .range(chunkIndex, chunkIndex)
    .maybeSingle();
  if (chunkError) throw chunkError;

  if (!chunkRow) {
    // MAP exhausted -- every chunk has been offered to extraction.
    return { nextStage: "merging", nextChunkIndex: null };
  }

  const provider = resolveIngestionProvider(ctx);

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
        // Every candidate extracted here comes from this ONE chunkRow
        // (extractLessons is called once per chunk, above) -- so all of
        // them inherit that chunk's section_id, not a per-candidate value.
        // Nullable by the same FK (064) that made source_chunk_id nullable:
        // a chunk with no detected section carries section_id: null, and a
        // lesson from it should too, not a guessed value.
        section_id: chunkRow.section_id,
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

  const provider = resolveIngestionProvider(ctx);

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
    const { data: insertedCards, error: insertError } = await ctx.supabase
      .from("cards")
      .insert(
        cards.map((c, i) => ({
          lesson_id: lessonRow.id,
          book_id: ctx.job.book_id,
          user_id: "00000000-0000-0000-0000-000000000000", // trigger-derived (set_user_id_from_book, 065)
          prompt_type: c.promptType,
          prompt: c.prompt,
          answer: c.answer,
          sort_order: i,
        })),
      )
      .select("id");
    if (insertError) throw insertError;

    // THE BUG THIS CLOSES (post-deploy finding, item 5 follow-up): a card
    // with no `card_states` row can never enter `get_session_queue` --
    // BOTH arms (071/126) select FROM card_states, never from cards, so a
    // card this stage creates and never gives a scheduler row to is
    // permanently unstudyable, readable only as inert lesson content.
    // `seed_meditations_deck` (103) has always done this
    // (`insert into card_states (card_id, user_id, book_id, state) values
    // (v_card_id, v_caller, v_book_id, 'new')`) for its seeded decks; this
    // is the real-ingestion path's own version of that exact insert,
    // mirrored column-for-column -- same four columns, same literal 'new'
    // state, no other column touched, so a real-ingested card and a seeded
    // one start scheduling from an identical, verified-correct row shape.
    //
    // WHY HERE, NOT A `finalizingStage` SWEEP: this stage's own delete-
    // then-insert of `cards` (keyed by `lesson_id`, see this function's own
    // header) already makes every card born here CASCADE-fresh on every
    // entry, including a retry of this exact lesson -- `cards`'s FK to
    // `card_states` is `ON DELETE CASCADE` (070), so the delete above has
    // already removed any card_states row a prior, incomplete attempt at
    // THIS lesson may have left behind, before a single new card id exists
    // to collide with. A plain (not upsert) insert is therefore correct,
    // not merely convenient: on the ONLY path that can re-run this stage
    // for an already-advanced lesson (a whole-book `reingest`), the cards
    // above were just deleted and given brand-new ids, so there is no
    // existing card_states row for those ids to conflict with, and no
    // already-reviewed card's row is ever touched -- a reviewed card's
    // history lives under a DIFFERENT card id than whatever this insert
    // just created. Silently upserting here would hide a genuine bug (a
    // stale id somehow reappearing) behind a swallowed conflict; this
    // insert is left to throw, on purpose, matching every other write in
    // this file's fail-closed posture (see `resolveIngestionProvider`'s own
    // header) rather than adding an `ON CONFLICT` this design never needs.
    //
    // `user_id` must be `ctx.job.user_id`, explicitly and correctly, not
    // the `cards` insert's zero-UUID placeholder above: `card_states`' own
    // trigger (`card_states_derive_and_check`, 070) derives `book_id` from
    // `card_id` unconditionally, but only OVERWRITES `user_id` when
    // `auth.uid()` is non-null (a real end-user session). Under this
    // worker's service-role client `auth.uid()` is null, so the trigger
    // instead VALIDATES the supplied `user_id` against the card's real
    // owner and raises if it does not match -- a placeholder here would
    // fail closed immediately, not silently misattribute the row.
    if (insertedCards && insertedCards.length > 0) {
      const { error: cardStatesError } = await ctx.supabase.from("card_states").insert(
        insertedCards.map((row) => ({
          card_id: row.id,
          user_id: ctx.job.user_id,
          book_id: ctx.job.book_id,
          state: "new" as const,
        })),
      );
      if (cardStatesError) throw cardStatesError;
    }
  }

  // D-018: promote iff at least one card survived; a denied lesson keeps
  // its pre-promotion ('archived') status, never touched further here.
  //
  // SCOPING FIX (the Boss's finding): this update was unconditional on
  // `id` alone -- every other write in this file that touches a specific
  // lesson row scopes by `status='archived'` too (extractingLessonsStage's
  // delete, mergingStage's reset), so a promotion here that isn't similarly
  // scoped is the one write in the pipeline that would blindly overwrite
  // whatever state the row is actually in, rather than only ever moving it
  // from the one state this stage is entitled to promote out of.
  if (cards.length > 0) {
    const { error: promoteError } = await ctx.supabase
      .from("lessons")
      .update({ status: "active" })
      .eq("id", lessonRow.id)
      .eq("status", "archived");
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
  // gateway-routed DeepSeekProvider, always). What R43 actually forbids --
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
  if (result.verdict !== "SUPPORTS") {
    const log = result.verdict === "CONTRADICTS" ? console.error : console.warn;
    log(
      `[verifying_grounding] lesson ${lesson.id} rejected -- verdict=${result.verdict} reason=${JSON.stringify(result.reason).slice(0, 300)}`,
    );

    const { error: rejectError } = await ctx.supabase
      .from("lessons")
      .update({ status: "rejected", rank: null })
      .eq("id", lesson.id)
      .eq("status", "archived");
    if (rejectError) throw rejectError;
  }

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
