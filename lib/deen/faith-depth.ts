/**
 * A3 Part 2 — the Faith depth dial (BOSS-VISION §4b rule 4). Three tiers,
 * lightest first, nothing defaulted to deepest:
 *   - prayers_only: the five prayers as anchors, on-time/late/missed. No
 *     gated feature — this tier is the floor every Faith row has.
 *   - prayers_quran: adds the Qur'an log.
 *   - full_practice: adds sunnah, adhkar, the Habit Builder, the private
 *     reflection log, and the qada backlog.
 *
 * `depthIncludes` gates RENDERING ONLY, never deletion — turning a tier
 * down hides a feature's entry points without touching its underlying
 * rows (quran_sessions, deen_habits, reflection_entries, ...). "Archiving
 * Faith keeps history too" (§4b rule 4) is the same principle one level up.
 *
 * "legacy" (not a `FaithDepth` value, not stored anywhere) is the M6
 * failsafe: an account with zero `user_domains` rows predates depth
 * entirely and must render byte-identical to today, i.e. every feature
 * unlocked — see lib/domains/get-user-domains.ts's own `mode: "legacy"`
 * discriminator, which is what a caller should pass through here rather
 * than inventing a second "no data" representation.
 *
 * There is deliberately NO other absent state to handle: `user_domains.
 * depth` is NOT NULL (migration 114), so a domains-mode Faith row always
 * carries a real tier the moment it exists — the ambiguous
 * "picked Faith, depth unanswered" state cannot occur in the data. (Faith
 * itself isn't a real `user_domains` key until migration 115's flatten
 * lands — this module's logic is independent of that and ready either way.)
 */

export type FaithDepth = "prayers_only" | "prayers_quran" | "full_practice";

export type FaithFeature = "quran" | "sunnah" | "adhkar" | "habits" | "reflection" | "qada_backlog";

const TIER_FEATURES: Record<FaithDepth, ReadonlySet<FaithFeature>> = {
  prayers_only: new Set(),
  prayers_quran: new Set(["quran"]),
  full_practice: new Set(["quran", "sunnah", "adhkar", "habits", "reflection", "qada_backlog"]),
};

export function depthIncludes(depth: FaithDepth | "legacy", feature: FaithFeature): boolean {
  if (depth === "legacy") return true;
  return TIER_FEATURES[depth].has(feature);
}
