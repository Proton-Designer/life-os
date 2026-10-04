import type { FeatureId } from "@/lib/features";

/**
 * Nav features to hide for the LEGACY nav: the stored hidden_features minus
 * "deen" (Deen Mode supersedes that entry -- D4 -- and the visibility UI no
 * longer lists it, so honouring a stored "deen" would be an un-removable
 * hide), plus "deen" whenever Deen Mode is OFF. Never rewrites the stored
 * array.
 */
export function effectiveHiddenFeatures(stored: FeatureId[], deenMode: boolean): FeatureId[] {
  const withoutDeen = stored.filter((f) => f !== "deen");
  return deenMode ? withoutDeen : [...withoutDeen, "deen"];
}
