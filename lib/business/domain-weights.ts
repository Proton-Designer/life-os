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
export async function getUserDomainWeights(userId: string): Promise<DomainWeights | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("user_domains").select("key, weight").eq("user_id", userId).is("archived_at", null);
  if (!data || data.length === 0) return null;
  const weights: DomainWeights = {};
  for (const row of data) {
    if (row.key === "personal_growth" || row.key === "work" || row.key === "school") {
      weights[row.key] = row.weight as DomainWeightTier;
    }
  }
  return weights;
}
