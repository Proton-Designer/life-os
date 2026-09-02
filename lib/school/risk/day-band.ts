import type { RiskBand } from "./assignment-risk";

// Ported from CollegeOS packages/core/src/risk/dayBand.ts. Not wired to a caller in
// School today — tracking-app has no ambient day-level risk surface (no "Aurora" field)
// to feed. Ported now, with its test suite, so it's ready the moment such a surface is
// requested; see the port report for why this one shipped without a caller.
//
// Simplified input shape from the CollegeOS original: that version took `DeliverableRisk[]`
// (a CollegeOS-schema-specific type keyed by numeric deliverable/course ids). The only
// thing this function ever reads is `.result.band`, so this port takes that directly —
// `readonly { band: RiskBand }[]` — rather than forcing a caller to first shape data into
// a type that doesn't otherwise exist in this codebase.

/**
 * The single risk band that characterises a whole day: **the highest band among the
 * items in play**, not an average. A day holding one critical item and nine low ones is
 * a critical day; averaging would report it as calm.
 *
 * Returns `null` for an empty list — that is the load-bearing case: nothing to assess
 * means no computed risk, not a fabricated calm reading.
 */
export function deriveDayBand(risks: readonly { band: RiskBand }[]): RiskBand | null {
  const BAND_ORDER: readonly RiskBand[] = ["low", "moderate", "high", "critical"];
  let rank = -1;
  for (const risk of risks) {
    const candidate = BAND_ORDER.indexOf(risk.band);
    if (candidate > rank) rank = candidate;
  }
  return rank === -1 ? null : (BAND_ORDER[rank] as RiskBand);
}
