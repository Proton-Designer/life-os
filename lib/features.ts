/**
 * L10 (docs/ai-connector/PROGRAM-PLAN.md): the narrow reading of "remove
 * unwanted features / add features they don't have yet" the Lead ruled on —
 * toggling VISIBILITY of already-built modules, not generating new ones.
 * `profiles.hidden_features` (a new migration, not yet numbered) stores the
 * set a user has turned off; every id here is a nav destination that can be
 * hidden without breaking navigation.
 *
 * Deliberately does NOT include "home" or "settings" — Home is the anchor
 * page (nothing else guarantees a way back to it) and Settings is the ONLY
 * place a hidden feature gets turned back on, so making either hideable
 * would be a self-inflicted lockout, not a feature. Both stay reachable
 * unconditionally in every nav component regardless of hidden_features.
 *
 * The id for each entry is the exact leading path segment
 * (`href.replace(/^\//, "")`) of its nav destination — components/shell/
 * sidebar-nav.tsx's SECTIONS and mobile-island.tsx's PRIMARY_ITEMS filter
 * against this list using that same derivation, so adding a new toggleable
 * module here never requires a second, separately-maintained mapping.
 */

export const FEATURE_IDS = ["deen", "work", "business", "school", "fitness", "insights"] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

export function isFeatureId(value: string): value is FeatureId {
  return (FEATURE_IDS as readonly string[]).includes(value);
}

/** Drops anything that isn't a real, current feature id — a stale DB value (a retired module's old id) never reaches a nav filter as a silently-inert-but-still-stored string. */
export function sanitizeHiddenFeatures(values: readonly string[] | null | undefined): FeatureId[] {
  if (!values) return [];
  return values.filter(isFeatureId);
}

export const FEATURES: Record<FeatureId, { label: string }> = {
  deen: { label: "Faith" },
  work: { label: "Work" },
  business: { label: "Business" },
  school: { label: "School" },
  fitness: { label: "Fitness" },
  insights: { label: "Insights" },
};
