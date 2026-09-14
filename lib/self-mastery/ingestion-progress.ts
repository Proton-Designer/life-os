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
 * DELIBERATELY QUERY-FREE. An earlier draft computed a mathematically
 * precise percentage (chunkIndex / true total chunks or lessons, via a
 * COUNT query per advance). Dropped in favour of this coarser, static
 * per-stage curve for two concrete reasons: (a) it keeps the route's only
 * database traffic on the write side (no extra SELECT per stage,
 * preserving budget for the 280s Vercel ceiling this route already
 * documents), and (b) it keeps this function pure and trivially testable
 * with no Supabase client at all. The number is an honest ESTIMATE, not a
 * measurement -- accurate enough to prove real, monotonic movement instead
 * of "0% then 100%," not a promise of calibrated accuracy.
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

// Per-chunk climb rate within a chunked stage's span, and the chunk count
// at which it saturates at the top of its span. Deliberately NOT derived
// from a true total (see the file header) -- a round number picked so a
// typical book (dozens to a couple hundred chunks/lessons, per
// worker-stages.ts's own measured comments) visibly climbs through most or
// all of its stage's span rather than saturating in the first few calls.
const PCT_PER_CHUNK = 2;

/**
 * `nextStage`/`nextChunkIndex` are exactly `StageWorkResult`'s own fields —
 * the position the cursor just advanced INTO, straight from
 * `advance_ingestion_cursor`'s caller. Returns `null` for `done`/`failed`:
 * see the file header for why those are deliberately left to their own
 * authoritative writers instead of this estimate.
 */
export function estimateBookProgressPct(nextStage: IngestStage, nextChunkIndex: number | null): number | null {
  if (nextStage === "done" || nextStage === "failed") return null;

  const base = STAGE_BASE_PCT[nextStage];
  const span = STAGE_SPAN_PCT[nextStage];
  if (span === undefined || nextChunkIndex === null || nextChunkIndex === undefined) {
    return base;
  }

  const climbed = Math.min(span, nextChunkIndex * PCT_PER_CHUNK);
  return Math.round(base + climbed);
}
