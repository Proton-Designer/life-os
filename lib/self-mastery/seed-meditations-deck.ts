// Wires the D-018 seeded sample deck (12 lessons, 47 cards, Marcus Aurelius'
// Meditations) into onboarding completion. Adapted from ULM's
// packages/core/src/seed/insert-meditations-deck.ts, which drove raw `pg`
// and faked auth via set_config('request.jwt.claim.sub', ...) because it had
// no real caller session. Here the auth context is real — `requireUser()`'s
// Supabase client already carries the signed-in user's JWT — so this is
// simpler by construction, not despite the port: one RPC call,
// `seed_meditations_deck` (supabase/migrations/100_ulm_seed_meditations_deck.sql),
// does the advisory lock, the idempotency check, the `self_mastery`-subdomain
// gate, and every insert in ONE transaction. A sequence of client-side
// `.insert()` calls would each be its own PostgREST transaction — the
// advisory lock wouldn't survive between them — which is exactly why this is
// an RPC and not a port of insert-meditations-deck.ts's individual queries.
//
// CONTENT IS STATIC, GENERATED ONCE, NOT PORTED AS CODE: `meditations-deck-payload.json`
// is the output of ULM's `npm run generate:deck-payload -w @ulm/core` — the
// REAL MEDITATIONS_DECK fixture, the REAL generateCardsForLesson(), and the
// REAL programmatically-extracted source_chunks text (see that repo's D-018
// work for why each of those is careful, verified content). The deck never
// changes at runtime and generateCardsForLesson() is pure, so there is
// nothing to gain from regenerating it per request — and porting ULM's
// card-generation algorithm into a repo with no other ingestion-pipeline
// concerns would just be duplication risk for zero benefit. Regenerate this
// file only by re-running that ULM-repo script, never by hand-editing it.
import type { createClient } from "@/lib/supabase/server";
import meditationsDeckPayload from "./meditations-deck-payload.json";

type TypedClient = Awaited<ReturnType<typeof createClient>>;

export type SeedMeditationsDeckResult =
  | { seeded: true; alreadySeeded: boolean; bookId: string; lessonCount: number; cardCount: number }
  | { seeded: false; reason: "self_mastery_not_selected" };

/**
 * Call unconditionally from onboarding completion — this is a documented
 * no-op (returns `{ seeded: false, reason: "self_mastery_not_selected" }`,
 * never throws for this case) for anyone who didn't keep the Self-Mastery
 * subdomain. Idempotent: calling this twice for the same user (a retried
 * onboarding completion) returns `alreadySeeded: true` the second time and
 * does not create a second deck.
 */
export async function seedMeditationsDeckForUser(supabase: TypedClient): Promise<SeedMeditationsDeckResult> {
  const { data, error } = await supabase.rpc("seed_meditations_deck", {
    p_lessons: meditationsDeckPayload as unknown as never,
  });
  if (error) throw error;
  return data as unknown as SeedMeditationsDeckResult;
}
