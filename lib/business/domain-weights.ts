import { createClient } from "@/lib/supabase/server";
import type { DomainWeights, DomainWeightTier } from "./domain-classification";

/**
 * The single fetch behind every classifyDomain call site (sn-ratio.ts,
 * sn-trend.ts via insights/page.tsx, insights-kpis.ts,
 * get-domain-snapshots.ts) — extracted so every Signal:Noise-shaped
 * surface reads the SAME weights the SAME way, rather than each
 * independently re-querying user_domains and risking drift between them.
 *
 * Active (non-archived) top-level domains only — an archived one isn't
 * part of "what this user currently tracks," same rule
 * computeNavDomainState applies for the four-tab shell. Zero rows is
 * exactly legacy mode (see domain-classification.ts's header): returning
 * null here, not an empty object, is what makes classifyDomain fall back
 * to the hardcoded deen+business split instead of silently classifying
 * every domain as "other" (an empty DomainWeights object would do that,
 * since no key would ever equal "essential").
 */
type TopLevelKey = keyof DomainWeights;

/**
 * Every key this fetch is willing to carry into a DomainWeights map. This
 * MUST stay in step with DomainWeights itself: a key the migration creates
 * but this set omits is dropped silently here, and classifyDomain then reads
 * its absence as a deselected area — the user's real answer, discarded one
 * layer before anything could notice. Migration 115 adds faith/body/learning
 * (and business, which stays unmapped in classifyDomain for now, but is
 * carried so it is available the moment T-0002 lands).
 */
const TOP_LEVEL_KEYS = new Set<TopLevelKey>([
  "personal_growth",
  "faith",
  "body",
  "learning",
  "business",
  "work",
  "school",
]);

export async function getUserDomainWeights(userId: string): Promise<DomainWeights | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("user_domains").select("key, weight").eq("user_id", userId).is("archived_at", null);
  if (!data || data.length === 0) return null;
  const weights: DomainWeights = {};
  for (const row of data) {
    if (TOP_LEVEL_KEYS.has(row.key as TopLevelKey)) {
      weights[row.key as TopLevelKey] = row.weight as DomainWeightTier;
    }
  }
  return weights;
}
