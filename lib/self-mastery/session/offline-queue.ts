// Offline/optimistic review queue — adapted from ULM's
// packages/core/src/session/offline-queue.ts. The UI advances immediately on
// grade; the FSRS next-state is computed at grade time (never re-derived at
// replay against a possibly-stale server state — see `PendingReview.nextState`)
// and the `submit_review` call is queued for retry.
//
// Three real adaptations beyond a mechanical port, all load-bearing:
//
// 1. `p_confidence` (085): the RPC call below is the 9-arg shape, not ULM's
//    original 8-arg one. `p_confidence: item.confidence ?? undefined` —
//    matching build-session.ts's `submitCardReview` exactly — because the
//    generated `Args` type distinguishes "key omitted" from "key present
//    with value `null`" under this repo's strict TS config; passing `null`
//    directly does not typecheck against the optional `?:` property.
//
// 2. **`isPermanentFailure`'s message list is re-derived from tracking-app's
//    LIVE `submit_review`, not copied from ULM's.** This is the exact hazard
//    named in docs/specs/convergence-coverage.md §6 (ULM repo): a function
//    redefined by later migrations makes an artefact written against an
//    earlier version silently stale. Checked directly: 081 added a NINTH
//    exception this platform's `submit_review` raises that ULM's original
//    schema never had — `'submit_review: book for card % has been deleted'`
//    (the soft-delete guard) — and it is genuinely permanent (retrying a
//    review against a card whose book stays deleted can never succeed). A
//    naive port of ULM's message list would have let this one fall through
//    to the transient default and retry forever: the exact poison-pill bug
//    this file exists to prevent, reintroduced by porting from a stale
//    source. Added below as its own matched case.
//
// 3. `sessionId` is NOT persisted per queued item. A review queued before an
//    app relaunch or a multi-day offline gap could carry a `work_sessions`
//    id that no longer resolves to today's session by the time it replays —
//    `start_session`'s resume-by-local-date logic means "today's session"
//    genuinely changes across a day boundary. `replayPendingReviews` instead
//    takes the CURRENT `sessionId` as a parameter, resolved by the caller
//    (via whatever wraps `start_session` — `loadTodaysSession()` /
//    `startTodaysSession` in this app) immediately before calling replay,
//    and applies it to every item in that pass. Every other field is still
//    captured at grade time and never recomputed.
//
// 4. LOST-RESPONSE RECOVERY (found by ow9rlnds's adversarial review of the
//    consuming code, 2026-09-01): if `submit_review`'s RPC call succeeds
//    server-side but the response never reaches the client (network drop
//    right after commit), the item stays queued and gets retried. The retry
//    correctly fails `submit_review`'s "reps must increase by exactly 1"
//    check (the server's `reps` already advanced from the first, silently-
//    successful attempt) and `isPermanentFailure` correctly classifies that
//    as permanent (never retry — retrying again can't help). But the review
//    genuinely landed; surfacing this to the user as "couldn't be saved" is
//    wrong. `replayPendingReviews` now VERIFIES rather than guesses: on a
//    reps-mismatch specifically, it queries `reviews` for the most recent
//    row on that card and compares rating/elapsed_ms/confidence/answered_text
//    (all four persisted verbatim in the queued item, never recomputed at
//    replay) against the item about to be retried. An exact match on all
//    four is treated as "this attempt already landed" — verified against the
//    database, not inferred from the error text or a retry-count heuristic,
//    so it doesn't need (and doesn't use) `item.attempts` to decide. See
//    `wasAlreadyApplied` below.
import type { createClient } from "@/lib/supabase/client";
import type { NextStateForRpc } from "../fsrs-scheduler";

/** Browser client — replay runs client-side, after reconnect (same "browser-only concern" discipline as `timer.ts`'s `visibilitychange` wiring). */
type TypedClient = ReturnType<typeof createClient>;

export interface QueueStorageAdapter {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
}

/** Guarded for SSR — `window` doesn't exist server-side, and this queue is a browser-only concern (same discipline as `timer.ts`'s `visibilitychange` wiring). */
export const localStorageAdapter: QueueStorageAdapter = {
  getItem: (key) => (typeof window === "undefined" ? null : window.localStorage.getItem(key)),
  setItem: (key, value) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
  removeItem: (key) => {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  },
};

export interface PendingReview {
  /** Client-generated, used for de-dup and as the replay-order tiebreaker. */
  id: string;
  cardId: string;
  rating: 1 | 2 | 3 | 4;
  elapsedMs: number;
  answeredText: string;
  aiFeedback: string | null;
  aiSuggestedRating: 1 | 2 | 3 | 4 | null;
  /** The calibration tap, captured before reveal — same field ULM never had, matching build-session.ts's `SubmitCardReviewInput.confidence`. */
  confidence: "sure" | "think_so" | "guessing" | null;
  /** Pre-computed at grade time via `fsrs-scheduler.ts`'s `computeNextState` +
   * `toRpcNextState` — replay submits this as-is, it never recomputes FSRS
   * against a possibly-stale server state fetched after reconnect. */
  nextState: NextStateForRpc;
  /** Strictly increasing per device (see `nextSequence`) — the replay order key. */
  queuedAt: number;
  /** How many times a transient failure has been retried for this item. Absent/0 on
   * first enqueue. Once this reaches `MAX_TRANSIENT_ATTEMPTS`, the item becomes a dead
   * letter (surfaced, dropped) rather than retried forever. */
  attempts?: number;
}

const STORAGE_KEY = "self-mastery.session.offline-review-queue.v1";
const MAX_TRANSIENT_ATTEMPTS = 5;

let sequenceCounter = 0;
/** A monotonically increasing counter, not `Date.now()` — guarantees a stable replay
 * order even if two reviews are queued within the same millisecond or the device clock
 * moves backward. Callers persisting across app restarts should seed from the highest
 * `queuedAt` already in storage; `enqueuePendingReview` does this automatically. */
export function nextSequence(): number {
  sequenceCounter += 1;
  return sequenceCounter;
}

export async function loadPendingReviews(storage: QueueStorageAdapter): Promise<PendingReview[]> {
  const raw = await storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingReview[]) : [];
  } catch {
    return [];
  }
}

async function savePendingReviews(storage: QueueStorageAdapter, reviews: PendingReview[]): Promise<void> {
  await storage.setItem(STORAGE_KEY, JSON.stringify(reviews));
}

export async function enqueuePendingReview(
  storage: QueueStorageAdapter,
  review: Omit<PendingReview, "queuedAt" | "attempts">,
): Promise<void> {
  const existing = await loadPendingReviews(storage);
  const highestQueuedAt = existing.reduce((max, r) => Math.max(max, r.queuedAt), 0);
  existing.push({ ...review, queuedAt: Math.max(highestQueuedAt + 1, nextSequence()), attempts: 0 });
  await savePendingReviews(storage, existing);
}

export type ReplayFailureClassification = "permanent" | "transient-retrying" | "transient-exhausted";

export interface ReplayFailure {
  id: string;
  cardId: string;
  error: string;
  classification: ReplayFailureClassification;
}

export interface ReplayResult {
  /** Ids the caller can treat identically: remove from the queue, no error to show.
   * Includes both a genuine RPC success this pass AND an item verified (via
   * `wasAlreadyApplied`) to have already landed on an earlier attempt whose
   * response was lost — see `recoveredLostResponses` for exactly which of
   * `succeeded` fall into the second case, if that distinction ever matters. */
  succeeded: string[];
  /** Every failure this pass produced, in the order encountered — never just the
   * first one. `permanent` and `transient-exhausted` entries have already been
   * removed from the queue (dead letters, surfaced here so the caller can show the
   * user something rather than losing the write silently); `transient-retrying`
   * entries are still queued for the next replay attempt. */
  failures: ReplayFailure[];
  /** Subset of `succeeded` recovered via `wasAlreadyApplied` — the RPC call this
   * pass reported a reps-mismatch, but a matching row already existed in `reviews`,
   * meaning an EARLIER attempt actually landed and only its response was lost.
   * Not a failure and not surfaced to the user as one; listed separately from
   * `succeeded` purely for observability (e.g. logging how often this recovery
   * path fires) — the caller can ignore this field entirely. */
  recoveredLostResponses: string[];
}

/** Postgres exceptions tracking-app's LIVE `submit_review` raises deliberately
 * (`supabase/migrations/078_ulm_start_session_submit_review.sql`, as extended
 * by `081_ulm_soft_delete_and_purge.sql` and `085_ulm_submit_review_confidence.sql`
 * — verified against `pg_get_functiondef` on the scratch DB, 2026-09-01, not
 * copied from ULM's original schema) — every one of these will fail
 * identically on every retry, because retrying doesn't change the card's
 * state, the caller's auth, or the proposed values. Network failures, 5xx,
 * and anything unrecognized default to transient — the safe default is
 * "assume retrying might help," never the reverse.
 *
 * ⚠️ THESE STRINGS ARE MATCHED AGAINST `submit_review`'s `raise` MESSAGES —
 * not a SQLSTATE code, not a structured error code, a string, spanning two
 * languages and two repositories, with nothing a compiler or a type checker
 * can see connecting the two sides. Changing one of those messages in the
 * SQL SILENTLY BREAKS RETRY CLASSIFICATION HERE: the failure reclassifies as
 * transient and this queue is back to retrying forever against a card whose
 * state can never change. `tsc` cannot catch this. No test catches it unless
 * it deliberately triggers the real error. This is not hypothetical — it
 * already happened once, in the other direction: `081`
 * (`supabase/migrations/081_ulm_soft_delete_and_purge.sql`) added
 * `'submit_review: book for card % has been deleted'`, which does not exist
 * in ULM's original schema, and porting ULM's classifier list without
 * re-deriving it from the live function would have missed it entirely (see
 * this file's header). The mirror-image warning lives on every `raise` in
 * `submit_review` itself (`supabase/migrations/088_ulm_submit_review_raise_comments.sql`)
 * — READ THAT COMMENT before rewording any exception message there. If you
 * change one anyway, update the matching string below in the SAME
 * migration/commit.
 */
/** The one `submit_review` failure that needs verification instead of a straight
 * permanent/transient classification — see adaptation 4 in this file's header. */
function isRepsMismatch(error: { message?: string } | null): boolean {
  return (error?.message ?? "").toLowerCase().includes("must increase by exactly");
}

/**
 * Queries `reviews` for the most recent row on `item.cardId` and checks whether it
 * IS this exact queued item, already landed. Verification, not inference: compares
 * four fields the client persisted verbatim at grade time and never recomputes
 * (`rating`, `elapsedMs`, `confidence`, `answeredText`) against the newest row for
 * that card. An exact match on all four is strong evidence this is the same
 * submission, not a coincidentally-similar different one — a different real review
 * matching a user's own rating AND millisecond-precision elapsed time AND
 * confidence tap AND answer text is not a realistic collision.
 *
 * RLS-safe by construction: `reviews_select` only returns the caller's own rows,
 * so this can never read (or leak information about) another user's review.
 *
 * Deliberately does NOT use `item.attempts` — a retry-count heuristic can't
 * distinguish "this exact submission already landed" from "a genuinely different
 * review landed in between" (e.g. the same card reviewed from a second device);
 * checking actual field equality against the database can, and is strictly more
 * accurate than counting attempts.
 */
async function wasAlreadyApplied(client: TypedClient, item: PendingReview): Promise<boolean> {
  const { data } = await client
    .from("reviews")
    .select("rating, confidence, elapsed_ms, answered_text")
    .eq("card_id", item.cardId)
    .order("reviewed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  return (
    data.rating === item.rating &&
    (data.confidence ?? null) === (item.confidence ?? null) &&
    data.elapsed_ms === item.elapsedMs &&
    (data.answered_text ?? null) === (item.answeredText ?? null)
  );
}

function isPermanentFailure(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  if (error.code === "PGRST301") return true; // JWT invalid/expired — PostgREST's own code
  return (
    message.includes("no card_states row") ||
    message.includes("must increase by exactly") ||
    message.includes("must be > 0") ||
    message.includes("must be in the future") ||
    message.includes("illegal transition") ||
    message.includes("rating must be") ||
    message.includes("no authenticated user") ||
    message.includes("state is required") ||
    message.includes("has been deleted") || // 081's book_is_deleted guard — NOT in ULM's original list, see file header
    (message.includes("session") && message.includes("not found")) ||
    message.includes("row-level security") ||
    message.includes("violates") || // constraint violations (FK, check, not-null, etc.)
    message.includes("jwt") // fallback if PostgREST ever omits the structured code
  );
}

/**
 * Replays queued reviews against `submit_review`. Processes every item in `queuedAt`
 * order, but a failure — of any classification — never stops the pass: it only blocks
 * *later items for that same card* (a real ordering dependency, from `submit_review`'s
 * reps+1 check), never items for a different card. Permanent failures and exhausted
 * transients are dropped from the queue and returned as dead letters; retryable
 * transients stay queued. A reps-mismatch specifically is verified against `reviews`
 * before being classified (see `wasAlreadyApplied`, adaptation 4 in the file header) —
 * if it turns out an earlier attempt already landed and only its response was lost,
 * the item is treated as succeeded, not a failure, and does not block later same-card
 * items either (the server's reps state genuinely advanced).
 *
 * `sessionId` is the CURRENT session id, resolved by the caller immediately before
 * calling this (see file header, adaptation 3) — every replayed item in this pass is
 * attributed to it, regardless of what was active when the review was originally
 * graded.
 */
export async function replayPendingReviews(
  client: TypedClient,
  storage: QueueStorageAdapter,
  sessionId: string,
): Promise<ReplayResult> {
  const queue = await loadPendingReviews(storage);
  const ordered = [...queue].sort((a, b) => a.queuedAt - b.queuedAt);

  const succeeded: string[] = [];
  const recoveredLostResponses: string[] = [];
  const failures: ReplayFailure[] = [];
  const droppedIds = new Set<string>();
  // Once a card has a failure that stays queued this pass, no later item for that same
  // card may be attempted — attempting it out of order would violate submit_review's
  // reps+1 check even if it happened to succeed on the network. Items for every OTHER
  // card are unaffected and keep being attempted.
  const blockedCardIds = new Set<string>();
  const stillQueued: PendingReview[] = [];

  for (const item of ordered) {
    if (blockedCardIds.has(item.cardId)) {
      stillQueued.push(item);
      continue;
    }

    let error: { message?: string; code?: string } | null = null;
    try {
      // Casts match build-session.ts's submitCardReview exactly: the generated
      // Args type marks p_ai_feedback/p_ai_suggested_rating/p_next_state as
      // non-nullable even though the underlying RPC params accept null/jsonb —
      // Supabase's generator doesn't carry RPC-argument nullability the way it
      // does for table columns.
      const result = await client.rpc("submit_review", {
        p_card_id: item.cardId,
        p_session_id: sessionId,
        p_rating: item.rating,
        p_elapsed_ms: item.elapsedMs,
        p_answered_text: item.answeredText,
        p_ai_feedback: item.aiFeedback as unknown as string,
        p_ai_suggested_rating: item.aiSuggestedRating as unknown as number,
        p_next_state: item.nextState as unknown as never,
        p_confidence: item.confidence ?? undefined,
      });
      error = result.error as unknown as { message?: string; code?: string } | null;
    } catch (thrown) {
      // A thrown exception (e.g. fetch itself rejecting on total network loss) is by
      // definition not a structured Postgres/PostgREST error — treat it as transient,
      // the safe default.
      error = { message: thrown instanceof Error ? thrown.message : String(thrown) };
    }

    if (!error) {
      succeeded.push(item.id);
      continue;
    }

    if (isRepsMismatch(error) && (await wasAlreadyApplied(client, item))) {
      // Verified, not guessed: an earlier attempt's RPC call landed server-side
      // and only its response was lost. Treat identically to a genuine success —
      // remove from the queue, no error surfaced — but keep it out of the normal
      // `permanent` bucket and record it separately for observability.
      droppedIds.add(item.id);
      succeeded.push(item.id);
      recoveredLostResponses.push(item.id);
      continue;
    }

    if (isPermanentFailure(error)) {
      droppedIds.add(item.id);
      failures.push({ id: item.id, cardId: item.cardId, error: error.message ?? "Unknown error", classification: "permanent" });
      // Does NOT block later items for this card — a permanent failure means this
      // specific review can never be applied, but if (unusually) another queued review
      // exists for the same card, there's no reason to also refuse that one; it will
      // get its own independent verdict.
      continue;
    }

    const attempts = (item.attempts ?? 0) + 1;
    if (attempts >= MAX_TRANSIENT_ATTEMPTS) {
      droppedIds.add(item.id);
      failures.push({
        id: item.id,
        cardId: item.cardId,
        error: error.message ?? "Unknown error",
        classification: "transient-exhausted",
      });
      // Exhausted, not blocking: a later independent review for this card is still
      // free to succeed on its own.
      continue;
    }

    stillQueued.push({ ...item, attempts });
    blockedCardIds.add(item.cardId);
    failures.push({ id: item.id, cardId: item.cardId, error: error.message ?? "Unknown error", classification: "transient-retrying" });
  }

  const remaining = stillQueued.filter((q) => !droppedIds.has(q.id));
  await savePendingReviews(storage, remaining);

  return { succeeded, failures, recoveredLostResponses };
}
