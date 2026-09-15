import type { IngestStage } from "./types";

/**
 * Estimated `books.progress_pct` for a stage the cursor just advanced INTO,
 * plus the matching `books.stage` sync — both consumed by
 * app/api/self-mastery/ingestion/step/route.ts right after a successful
 * `advance_ingestion_cursor` call.
 *
 * WHY THIS EXISTS (S6, 2026-09-14, "no way to upload a book" investigation).
 * Two bugs, found together, both invisible from the outside because nothing
 * ever exercised a real multi-stage run against production before now:
 *
 * 1. `books.progress_pct` was written in exactly two places in this whole
 *    codebase: `uploadBook` (0, at creation) and `finalizingStage` (100, at
 *    completion). Every stage handler in worker-stages.ts computes real
 *    work and returns a real `StageWorkResult`, and NONE of them touch
 *    `books` at all -- by design, per that file's own header ("every
 *    earlier stage... leaves books alone, matching precedent"). So a user
 *    watching a real ~70-minute ingestion run saw 0% the entire time, then
 *    a jump to 100%. Not a rendering bug -- the number genuinely never
 *    changed in the database.
 *
 * 2. WORSE: `books.stage` was equally frozen, and for the same reason --
 *    nothing ever wrote it past its `'queued'` default. Only
 *    `ingestion_jobs.stage` (a SEPARATE column on a separate table) ever
 *    advances, via `advance_ingestion_cursor`. Every reader in this repo
 *    (get-library.ts, get-in-progress-books.ts, get-book-detail.ts) selects
 *    `books.stage`, not `ingestion_jobs.stage` -- so the stage LABEL a user
 *    sees (`INGESTION_STAGE_LABEL` via `bucketIngestStage`) was stuck on
 *    "Reading your book" for the entire run, and once a book had been
 *    `queued` for over `NO_WORKER_THRESHOLD_MS`, `looksUnclaimed` would
 *    start reporting "Not yet started" for a book that was, in fact, deep
 *    into `generating_cards` -- actively misleading, not merely stale.
 *
 * THE FIX IS IN THE ROUTE, NOT HERE: this file only computes numbers. The
 * route is what owns writing `books.stage`/`books.progress_pct` in the same
 * call that advances the cursor, so the two can never drift apart by more
 * than one stage transition.
 *
 * REVISION (2026-09-15, found by the Lead watching a real book run all
 * evening): the "earlier draft" this header used to describe as rejected --
 * a mathematically precise `position / true total` climb -- turned out to
 * be necessary, not merely nice to have. The static PCT_PER_CHUNK curve
 * below saturates at a stage's ceiling after a small, fixed chunk count
 * (currently ~23 for a 45-point span) regardless of how many chunks/lessons
 * the book actually has -- fine for a small book, but book 3d7a3825 (203
 * chunks, 60 ranked lessons) sat visibly frozen at 55% for ~3 hours through
 * all of extracting_lessons, then frozen at 97% for ~50 minutes through most
 * of generating_cards. #6's whole purpose was eliminating exactly this
 * shape of stall.
 *
 * STILL PURE, STILL QUERY-FREE HERE. This function takes `total` as a
 * plain parameter rather than fetching it itself -- the route (the only
 * caller) owns the one cheap COUNT query per tick this needs (source_chunks
 * for extracting_lessons, rank-not-null lessons for verifying_grounding/
 * generating_cards -- see route.ts's `fetchStageTotal`), keeping this file
 * itself trivially testable with no Supabase client, same as before.
 * `total` is OPTIONAL and falls back to the original static curve when
 * omitted/null/non-positive (a count query failed, or a caller that hasn't
 * been updated) -- never throws over a missing denominator. The number
 * remains an honest ESTIMATE, not a guaranteed-precise measurement: monotonic
 * movement through real positions matters far more here than exact accuracy.
 *
 * TERMINAL STAGES ARE NOT THIS FUNCTION'S JOB. `done` and `failed` both
 * return `null` -- `finalizingStage` already writes the authoritative
 * `progress_pct` (100 on success; left wherever it was on the "zero
 * teachable lessons" failure path) directly, and the exhausted-attempts
 * failure path in route.ts writes `books.status` itself. This function
 * exists for the stages IN BETWEEN, where nothing else ever writes
 * anything.
 */

// Where each stage's climb STARTS. Values are cumulative low-water marks,
// not independent chunks — chosen so the number only ever goes up (matching
// the documented STAGE_HANDLERS order in worker-stages.ts: chunking ->
// extracting_lessons -> merging -> verifying_grounding -> generating_cards
// -> finalizing -> done). `embedding` is unreachable in practice (no
// embedder exists in this repo, ADR-003/R43) but kept for type completeness
// — STAGE_HANDLERS never routes here for it.
const STAGE_BASE_PCT: Record<Exclude<IngestStage, "done" | "failed">, number> = {
  queued: 2,
  extracting_text: 2,
  parsing_structure: 2,
  chunking: 2,
  embedding: 8,
  extracting_lessons: 10,
  merging: 55,
  verifying_grounding: 60,
  generating_cards: 75,
  finalizing: 97,
};

// How far a CHUNKED stage is allowed to climb above its own base before the
// next stage's base takes over — e.g. extracting_lessons climbs from 10
// toward 10+45=55, generating_cards' own base. Stages absent here (the
// whole-book ones: queued/extracting_text/parsing_structure/chunking/
// embedding/merging/finalizing) return their flat base regardless of
// chunkIndex — there is no per-chunk position to climb through.
const STAGE_SPAN_PCT: Partial<Record<IngestStage, number>> = {
  extracting_lessons: 45, // 10 -> 55 (merging's base)
  verifying_grounding: 15, // 60 -> 75 (generating_cards' base)
  generating_cards: 22, // 75 -> 97 (finalizing's base)
};

// FALLBACK ONLY, as of the 2026-09-15 revision (see file header) -- the
// per-chunk climb rate used only when the real caller-supplied `total` is
// unavailable. A round number picked so a typical book (dozens to a couple
// hundred chunks/lessons, per worker-stages.ts's own measured comments)
// visibly climbs through most or all of its stage's span rather than
// saturating in the first few calls -- kept unchanged from the original
// design specifically so every existing call site/test that omits `total`
// keeps behaving exactly as it did before this revision.
const PCT_PER_CHUNK = 2;

/**
 * `nextStage`/`nextChunkIndex` are exactly `StageWorkResult`'s own fields —
 * the position the cursor just advanced INTO, straight from
 * `advance_ingestion_cursor`'s caller. Returns `null` for `done`/`failed`:
 * see the file header for why those are deliberately left to their own
 * authoritative writers instead of this estimate.
 *
 * `total` is the real denominator for the stage's own unit (source_chunks
 * for extracting_lessons; rank-not-null lessons for verifying_grounding/
 * generating_cards) -- the caller's responsibility to fetch (route.ts's
 * `fetchStageTotal`), not this function's. Omitted, `null`, or non-positive
 * (0, a failed count) all fall back to the static PCT_PER_CHUNK curve rather
 * than dividing by zero or throwing -- see the file header.
 */
export function estimateBookProgressPct(nextStage: IngestStage, nextChunkIndex: number | null, total?: number | null): number | null {
  if (nextStage === "done" || nextStage === "failed") return null;

  const base = STAGE_BASE_PCT[nextStage];
  const span = STAGE_SPAN_PCT[nextStage];
  if (span === undefined || nextChunkIndex === null || nextChunkIndex === undefined) {
    return base;
  }

  const climbed =
    total !== undefined && total !== null && total > 0
      ? Math.min(span, span * (nextChunkIndex / total))
      : Math.min(span, nextChunkIndex * PCT_PER_CHUNK);
  return Math.round(base + climbed);
}
