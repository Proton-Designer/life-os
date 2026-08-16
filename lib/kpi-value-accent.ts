import type { AccentToken } from "@/lib/accent-tokens";

/**
 * Shared "0 = neutral, any activity = positive" tint rule — used by every
 * KPI card whose value is a plain activity count with no domain-specific
 * "high owed count is bad" inversion (unlike accentForQadaBacklog).
 * Opus Lead review (2026-08-16): tint follows the card's own value, not
 * the domain accent, so a KPI row doesn't read as one striped band.
 */
export function accentForActivityCount(value: number): AccentToken {
  return value > 0 ? "business" : "neutral";
}
