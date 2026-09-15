/**
 * P2-11's escalation gate — same SHAPE as lib/distractions/plan-rules.ts's
 * `mustRewrite`/`FORCED_REWRITE_AFTER_SKIPS` (the concrete "existing
 * escalation pattern" the roadmap names as reusable): a pure threshold-gate
 * function plus a named constant, tripping a forced extra step in the UI
 * rather than a plain tap-through.
 *
 * DIRECTION: the MORE a user has voted for a habit (invested in the
 * identity), the HARDER killing it should be to do by accident —
 * sunk-cost/loss-aversion friction, matching "escalating" in this task's
 * own title describing the KILL FLOW getting more demanding as investment
 * grows, not a reaction to neglect (the opposite direction from
 * mustRewrite, which escalates on repeated FAILURE — the shape is reused,
 * the polarity is deliberately different, because a killed identity habit
 * and a skipped distraction plan are opposite kinds of event).
 */

/** Two weeks of votes — enough real investment that killing it should require a real reason, not just a tap. */
export const KILL_REQUIRES_REASON_AFTER_VOTES = 14;

export function killRequiresReason(voteCount: number): boolean {
  return voteCount >= KILL_REQUIRES_REASON_AFTER_VOTES;
}
