// Pure helpers for turning a SessionPlan into the linear card sequence the
// overlay walks through, and for deciding when a self-explanation
// interstitial falls. Split out from the overlay component so the ordering
// logic (warm-up -> due -> new -> closer LAST; the interstitial's re-rolled
// gap) is unit-testable without rendering anything.
import type { SessionCard, SessionPlan } from "@/lib/self-mastery/session/types";

/** warm-up -> due (interleaved) -> new -> closer, closer always last regardless of its original reason. */
export function buildCardSequence(plan: SessionPlan): SessionCard[] {
  const sequence = [...plan.warmUp, ...plan.due, ...plan.fresh];
  if (plan.closer) sequence.push(plan.closer);
  return sequence;
}

/**
 * A self-explanation interstitial falls every 4-6 cards (session-screen-spec.md
 * §1.4: "re-roll the gap each time"). `random` is injectable so this is
 * deterministic in tests; defaults to Math.random for real use.
 */
export function rollNextInterstitialGap(random: () => number = Math.random): number {
  return 4 + Math.floor(random() * 3); // 4, 5, or 6
}
