/**
 * P3-05 / P3-11: the mirror-image of `lib/features.ts`'s `hidden_features` --
 * same `text[]`-on-`profiles` shape and CHECK-constraint-against-a-TS-enum
 * convention, but the OPPOSITE default direction. `hidden_features` hides an
 * existing, default-ON module; `profiles.enabled_features` turns ON a new,
 * default-OFF feature the user has to opt into. Both P3-05 (cards_library)
 * and P3-11 (estimate_vs_actual) are re-decide items that reverse an earlier
 * deliberate product stance (see OPEN_QUESTIONS.md's own [P3-05] entry) --
 * shipping them OFF by default, behind this shared flag, is what makes that
 * reversal safe to ship unattended.
 */

export const OPT_IN_FEATURE_IDS = ["cards_library", "estimate_vs_actual"] as const;
export type OptInFeatureId = (typeof OPT_IN_FEATURE_IDS)[number];

export function isOptInFeatureId(value: string): value is OptInFeatureId {
  return (OPT_IN_FEATURE_IDS as readonly string[]).includes(value);
}

/** Drops anything that isn't a real, current opt-in feature id -- a stale DB value (a retired feature's old id) never reaches a gate check as a silently-inert-but-still-stored string. Mirrors `sanitizeHiddenFeatures`'s own reasoning exactly. */
export function sanitizeEnabledFeatures(values: readonly string[] | null | undefined): OptInFeatureId[] {
  if (!values) return [];
  return values.filter(isOptInFeatureId);
}

export function hasOptInFeature(enabledFeatures: readonly string[] | null | undefined, featureId: OptInFeatureId): boolean {
  return sanitizeEnabledFeatures(enabledFeatures).includes(featureId);
}

export const OPT_IN_FEATURES: Record<OptInFeatureId, { label: string; description: string }> = {
  cards_library: {
    label: "Cards library",
    description: "Goal/Motivation/Thought-Habit/Trait cards plus a manually-triggered End-of-Hour reflection ritual.",
  },
  estimate_vs_actual: {
    label: "Estimate vs. actual",
    description: "Track how your time estimates compare to what a task actually took.",
  },
};
