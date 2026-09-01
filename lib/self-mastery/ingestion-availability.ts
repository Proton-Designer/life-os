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
 * This flag is deliberately DERIVED, not hand-set: it reads whether a model
 * provider is configured at all. The moment a key is present and the worker
 * ships, uploads light up on their own — nobody has to remember to flip a
 * boolean, which is precisely the kind of thing nobody remembers.
 *
 * Server-only. The UI hides the affordance and `uploadBook` refuses
 * independently — a UI-only guard and a server guard produce the same
 * observation from a click-through, and only one of them is the invariant.
 * That is the same rule `e2e/onboarding.spec.ts` asserts for the
 * minimum-one-subdomain rule.
 */
export function isIngestionAvailable(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.SELF_MASTERY_INGESTION_URL,
  );
}

/** Shown wherever the upload affordance would otherwise be. Honest, not coy. */
export const INGESTION_UNAVAILABLE_MESSAGE =
  "Adding your own books isn't available yet — the text extraction service isn't connected. Your starter deck is ready to study in the meantime.";
