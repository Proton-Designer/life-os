/**
 * Is book ingestion actually available in this deployment?
 *
 * WHY THIS EXISTS (2026-09-01, found by the stranger-journey acceptance run)
 *
 * `uploadBook` does exactly what it claims: stores the PDF, sets the book to
 * `processing`, and inserts an `ingestion_jobs` row at `stage: "queued"`.
 * **Nothing anywhere consumes that queue.** The worker (ULM's `apps/worker`)
 * is not ported, and no model provider is configured.
 *
 * So a user who uploads a book gets a card that says "processing" forever.
 * `get-in-progress-books.ts` selects exactly `["uploading", "processing"]`, so
 * it sits at the top of their library permanently. There is no timeout, no
 * failure path, and no way for them to tell that nothing is coming.
 *
 * **That is worse than not offering the feature.** An absent feature is a gap;
 * an inviting button that silently eats a file is a broken promise, and the
 * user's reasonable conclusion is that the app is broken rather than
 * incomplete. Onboarding currently offers this to people in their first
 * ninety seconds with the product.
 *
 * GATED ON THE WORKER, NOT ON AN API KEY — and this distinction is the whole
 * point of the flag.
 *
 * When bring-your-own-key landed, the obvious move was to light uploads up for
 * any user who supplied a DeepSeek key. That would have re-created the exact
 * bug this file exists to prevent: a key lets you CALL a model, but ingestion
 * needs a process that claims `ingestion_jobs`, parses a PDF, and writes
 * lessons and cards. Without that process the upload still strands the book at
 * "processing" forever — now with the added insult that the user paid for a key
 * to unlock it.
 *
 * So availability keys off SELF_MASTERY_INGESTION_URL: the worker's own
 * endpoint. A user's personal key can never satisfy it, because a credential is
 * not a consumer.
 *
 * Server-only. The UI hides the affordance and `uploadBook` refuses
 * independently — a UI-only guard and a server guard produce the same
 * observation from a click-through, and only one of them is the invariant.
 * That is the same rule `e2e/onboarding.spec.ts` asserts for the
 * minimum-one-subdomain rule.
 */
export function isIngestionAvailable(): boolean {
  return Boolean(process.env.SELF_MASTERY_INGESTION_URL);
}

/** Shown wherever the upload affordance would otherwise be. Honest, not coy. */
export const INGESTION_UNAVAILABLE_MESSAGE =
  "Adding your own books isn't available yet — the service that turns a PDF into lesson cards isn't connected. Your starter deck is ready to study in the meantime.";
