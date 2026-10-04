import { getProfile } from "@/lib/supabase/auth";
import { hasOptInFeature, type OptInFeatureId } from "@/lib/opt-in-features";

/**
 * Server-side gate for an opt-in feature (profiles.enabled_features) in Server Actions: the UI
 * hides the controls, but an action is a public POST endpoint, so hiding is not refusing. Reads
 * the request-cached profile (free where a page already loaded it). OFF = refuse; never touches
 * the feature's data. Fails closed (hasOptInFeature: null/missing/unknown reads as OFF).
 */
export async function isOptInFeatureOnForRequest(featureId: OptInFeatureId): Promise<boolean> {
  return hasOptInFeature((await getProfile())?.enabled_features, featureId);
}

export const FEATURE_OFF_MESSAGE = "This feature is off. Turn it on in Settings -> Optional features.";
