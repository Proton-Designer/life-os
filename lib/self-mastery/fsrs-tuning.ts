import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fsrs, generatorParameters, createEmptyCard, checkParameters, default_w, type Card, type Grade } from "ts-fsrs";
import { requireUser } from "@/lib/supabase/auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * P3-20 -- per-user FSRS parameter tuning, gated on >=1000 logged reviews
 * (migration 072's own header anticipated exactly this feature).
 *
 * WHY REPLAY ts-fsrs ITSELF, NOT A HAND-ROLLED FSRS FORMULA: the tuned
 * weights this produces are only meaningful if they're evaluated against
 * the SAME state-transition math the live scheduler (fsrs-scheduler.ts's
 * getScheduler) actually runs. Reimplementing FSRS's stability/difficulty
 * update formulas independently would risk a subtle divergence from
 * ts-fsrs's own internals, silently invalidating the whole optimization.
 * Every candidate weight vector is evaluated by literally constructing an
 * `fsrs(generatorParameters({w}))` instance and replaying the user's real
 * review sequence through its own `.next()`/`.get_retrievability()` --
 * this module never touches the underlying FSRS math directly.
 *
 * LOSS FUNCTION: for each review after an item's first (there is nothing
 * to predict before any history exists), compute the model's predicted
 * retrievability just before applying that review's rating, compare
 * against the actual outcome (rating>=2 "recalled" vs rating===1
 * "forgot") via binary cross-entropy, and average across every review in
 * the user's whole history. This is the standard DSR-loss shape real FSRS
 * optimizers (e.g. FSRS4Anki) use, adapted to call through ts-fsrs
 * directly instead of a bespoke differentiable model.
 *
 * OPTIMIZER: coordinate-wise hill-climbing (finite-difference, since
 * ts-fsrs's `.next()` is an opaque black box with no analytic gradient
 * available) starting from ts-fsrs's own `default_w` -- NEVER makes the
 * loss worse: a candidate step is only kept when it strictly improves the
 * running best. Bounded iteration/step-size counts, and a hard cap on how
 * many of the user's most recent reviews are replayed per evaluation, to
 * keep this synchronous inside one Server Action call (per the Lead's
 * approved design) instead of a background job.
 *
 * TIMING: not benchmarked against a real production account (flagged
 * honestly, not silently assumed) -- but lib/self-mastery/__tests__/
 * run-fsrs-tuning.test.ts DOES run the real optimizer end-to-end over a
 * synthetic 1000-review history (the gate's exact minimum, 20 items x 50
 * reviews) inside a normal `vitest` test, completing in well under a
 * second in-process. Real user data will differ in shape (a request-
 * retention default, real gap distributions, ratings correlated with real
 * recall rather than a fixed pattern), so this is evidence the approach
 * is computationally reasonable at the gate's scale, not proof of exact
 * production timing. If a real account's tuning run proves too slow in
 * practice, lowering `MAX_REVIEWS_FOR_TUNING` or the iteration count are
 * the first two knobs to turn, not a redesign.
 *
 * SECURITY (the Lead's explicit ruling): `runFsrsTuning` takes NO userId
 * argument at all -- it calls `requireUser()` itself, so the row it writes
 * (via a service-role client, since migration 219's RLS forbids a direct
 * authenticated write) can never diverge from the actual cookie-authenticated
 * caller. Rate-limited via `trained_at` itself (no extra column needed): a
 * retrain within `RETUNE_COOLDOWN_MS` of the last one is rejected before
 * any of the expensive replay work runs.
 */

export const FSRS_TUNING_MIN_REVIEWS = 1000;
const MAX_REVIEWS_FOR_TUNING = 5000;
const MAX_ITERATIONS = 6;
const INITIAL_STEP_FRACTION = 0.15;
const STEP_SHRINK_PER_ITERATION = 0.5;
const LOSS_EPSILON = 1e-6;
/** Retraining is a heavy, whole-history replay -- there is no reason to ever run it more than once a day, even for a very active user, since a single day's reviews can't meaningfully shift a fit over thousands of prior ones. */
const RETUNE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface ReviewLogEntry {
  itemKey: string;
  rating: 1 | 2 | 3 | 4;
  reviewedAt: Date;
}

/**
 * Validates a weights array before it's ever handed to `generatorParameters`
 * (read OR write, per the Lead's ruling): the library's own `checkParameters`
 * (length + internal bounds, per ts-fsrs's own doc example) plus an
 * explicit finite-number check (a stored `real[]` column can in principle
 * carry `NaN`/`Infinity` from a corrupted row, which `checkParameters`
 * itself does not guard against). Returns the validated array, or `null`
 * on ANY failure -- the caller falls back to ts-fsrs's own library
 * defaults, so a bad row can never break scheduling for that user.
 */
export function validateFsrsWeights(w: unknown): number[] | null {
  if (!Array.isArray(w) || w.length !== default_w.length) return null;
  if (!w.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  try {
    return checkParameters(w) as number[];
  } catch {
    return null;
  }
}

/** Total logged reviews for the gate check -- a plain count, no row data fetched. */
export async function getUserReviewCount(supabase: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await supabase.from("reviews").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Reuses the exact review-history query shape scheduler-cache.ts already
 * established (card_id/question_id are XOR per migration 111's
 * `reviews_item_xor`), scoped to the most recent `MAX_REVIEWS_FOR_TUNING`
 * reviews for the compute-time cap described above, then grouped back
 * into per-item chronological sequences (oldest-first within each item --
 * necessary for a correct replay regardless of the outer query's own
 * fetch order).
 */
export async function getReviewLogForTuning(supabase: SupabaseClient, userId: string): Promise<ReviewLogEntry[][]> {
  const { data, error } = await supabase
    .from("reviews")
    .select("card_id, question_id, rating, reviewed_at")
    .eq("user_id", userId)
    .order("reviewed_at", { ascending: false })
    .limit(MAX_REVIEWS_FOR_TUNING);
  if (error) throw error;

  const byItem = new Map<string, ReviewLogEntry[]>();
  for (const row of data ?? []) {
    const itemKey = (row.card_id ?? row.question_id) as string;
    const entry: ReviewLogEntry = { itemKey, rating: row.rating as 1 | 2 | 3 | 4, reviewedAt: new Date(row.reviewed_at as string) };
    if (!byItem.has(itemKey)) byItem.set(itemKey, []);
    byItem.get(itemKey)!.push(entry);
  }
  // The query fetched newest-first (to bound to the N most recent reviews
  // overall); each item's own sequence must be replayed oldest-first.
  for (const entries of byItem.values()) entries.reverse();
  return [...byItem.values()];
}

function binaryCrossEntropy(predicted: number, actualRecalled: boolean): number {
  const p = Math.min(Math.max(predicted, LOSS_EPSILON), 1 - LOSS_EPSILON);
  return actualRecalled ? -Math.log(p) : -Math.log(1 - p);
}

/** Mean per-review loss for a candidate weight vector, replayed through a REAL ts-fsrs instance built from it. Exported for direct testing of the loss surface, independent of the optimizer that searches it. */
export function meanLossForWeights(sequences: ReviewLogEntry[][], w: readonly number[]): number {
  const scheduler = fsrs(generatorParameters({ w: w as number[], enable_fuzz: false }));
  let totalLoss = 0;
  let n = 0;
  for (const seq of sequences) {
    if (seq.length === 0) continue;
    let card: Card = createEmptyCard(seq[0]!.reviewedAt);
    for (let i = 0; i < seq.length; i++) {
      const { rating, reviewedAt } = seq[i]!;
      if (i > 0) {
        const predicted = scheduler.get_retrievability(card, reviewedAt, false) as number;
        totalLoss += binaryCrossEntropy(predicted, rating >= 2);
        n++;
      }
      const { card: nextCard } = scheduler.next(card, reviewedAt, rating as Grade);
      card = nextCard;
    }
  }
  return n > 0 ? totalLoss / n : 0;
}

export interface FsrsTuningResult {
  weights: number[];
  loss: number;
}

/**
 * Coordinate-wise hill-climb from ts-fsrs's own `default_w`. Each
 * iteration sweeps every weight index, trying a +/- step (shrinking each
 * iteration for coarse-to-fine search) and keeping only strictly-improving
 * moves. Stops early once a full sweep produces no improvement.
 */
export function optimizeFsrsWeights(sequences: ReviewLogEntry[][]): FsrsTuningResult {
  let w = [...default_w];
  let bestLoss = meanLossForWeights(sequences, w);

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const stepFraction = INITIAL_STEP_FRACTION * STEP_SHRINK_PER_ITERATION ** iteration;
    let improvedThisSweep = false;

    for (let i = 0; i < w.length; i++) {
      const step = Math.max(Math.abs(w[i]!), 0.1) * stepFraction;
      for (const direction of [1, -1]) {
        const candidate = [...w];
        candidate[i] = Math.max(0, candidate[i]! + direction * step);
        const loss = meanLossForWeights(sequences, candidate);
        if (loss < bestLoss - LOSS_EPSILON) {
          bestLoss = loss;
          w = candidate;
          improvedThisSweep = true;
        }
      }
    }

    if (!improvedThisSweep) break;
  }

  return { weights: w, loss: bestLoss };
}

export interface FsrsTuningStatus {
  reviewCount: number;
  eligible: boolean;
  tunedAt: string | null;
  reviewCountAtTrain: number | null;
}

/** Read-only status for the UI: how close to the gate, and whether a tuned row already exists. Never runs the optimizer. */
export async function getFsrsTuningStatus(supabase: SupabaseClient, userId: string): Promise<FsrsTuningStatus> {
  const [reviewCount, existing] = await Promise.all([
    getUserReviewCount(supabase, userId),
    supabase.from("fsrs_user_parameters").select("trained_at, review_count_at_train").eq("user_id", userId).maybeSingle(),
  ]);
  if (existing.error) throw existing.error;
  return {
    reviewCount,
    eligible: reviewCount >= FSRS_TUNING_MIN_REVIEWS,
    tunedAt: existing.data?.trained_at ?? null,
    reviewCountAtTrain: existing.data?.review_count_at_train ?? null,
  };
}

/**
 * The per-review-write hot path's own read: tuned, VALIDATED weights if
 * they exist, else `undefined` (rides ts-fsrs's own default `w`, exactly
 * today's behavior). Never throws -- a missing OR invalid row is just
 * "not tuned yet" from the scheduler's point of view, never an error that
 * could block a review submission.
 */
export async function getUserFsrsWeights(supabase: SupabaseClient, userId: string): Promise<number[] | undefined> {
  const { data, error } = await supabase.from("fsrs_user_parameters").select("weights").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data?.weights) return undefined;
  return validateFsrsWeights(data.weights) ?? undefined;
}

/**
 * Runs the gate + cooldown + optimizer and writes the result via a
 * service-role client (migration 219's RLS forbids a direct authenticated
 * write -- `weights` is a computed artifact, not client input). Identity
 * comes ONLY from `requireUser()`, called here, never from a caller-
 * supplied argument -- the Lead's explicit ruling, so this can never write
 * a row for anyone other than the actual signed-in caller. Throws with a
 * user-facing message on the gate/cooldown/validation failure paths;
 * the Server Action wrapper turns that into a plain result.
 */
export async function runFsrsTuning(): Promise<FsrsTuningResult & { reviewCount: number }> {
  const { supabase, userId } = await requireUser();

  const { data: existing, error: existingError } = await supabase.from("fsrs_user_parameters").select("trained_at").eq("user_id", userId).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.trained_at) {
    const elapsedMs = Date.now() - new Date(existing.trained_at).getTime();
    if (elapsedMs < RETUNE_COOLDOWN_MS) {
      const waitHours = Math.ceil((RETUNE_COOLDOWN_MS - elapsedMs) / (60 * 60 * 1000));
      throw new Error(`Already tuned recently -- try again in about ${waitHours}h.`);
    }
  }

  const reviewCount = await getUserReviewCount(supabase, userId);
  if (reviewCount < FSRS_TUNING_MIN_REVIEWS) {
    throw new Error(`Needs ${FSRS_TUNING_MIN_REVIEWS} logged reviews to tune (you have ${reviewCount}).`);
  }

  const sequences = await getReviewLogForTuning(supabase, userId);
  const { weights, loss } = optimizeFsrsWeights(sequences);
  const validated = validateFsrsWeights(weights);
  if (!validated) throw new Error("Tuning produced an invalid result. Try again.");

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("fsrs_user_parameters")
    .upsert({ user_id: userId, weights: validated, trained_at: new Date().toISOString(), review_count_at_train: reviewCount, loss }, { onConflict: "user_id" });
  if (error) throw error;

  return { weights: validated, loss, reviewCount };
}
