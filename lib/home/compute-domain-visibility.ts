import type { UserDomainsState } from "@/lib/domains/get-user-domains";
import { hasArea } from "@/lib/domains/area-vocabulary";

export type DomainVisibility = {
  hasFaith: boolean;
  hasFitness: boolean;
  hasWork: boolean;
  hasSchoolDomain: boolean;
};

/**
 * Home's body-level gating (Opus Lead finding, stranger-journey e2e): the
 * nav gated correctly on getUserDomains(), but Home's own content did not
 * — Sector progress and This Week's Focus rendered all 5 legacy domains
 * unconditionally, advertising domains a user explicitly declined during
 * onboarding. Extracted to a pure function specifically so the M6
 * guarantee — a legacy account (onboarding_completed=true, zero
 * user_domains rows, predates domain selection entirely) sees EVERY flag
 * true, exactly as it always has — is directly unit-testable rather than
 * living untested inside a Server Component that also does five DB
 * round trips.
 *
 * Deen and Fitness gate on their PERSONAL GROWTH SUBDOMAIN specifically,
 * not just the top-level domain — someone who kept Personal Growth but
 * dropped Fitness must not see a Fitness sector. Business and Co-op
 * (displayed as "Work") both gate on the "work" top-level domain — the old
 * single-business-model tables are what "Work" means today, ahead of the
 * user-created-subdomain rebuild.
 */
export function computeDomainVisibility(domainsState: UserDomainsState): DomainVisibility {
  const isLegacy = domainsState.mode === "legacy";
  const activeDomains = new Set(domainsState.mode === "domains" ? domainsState.domains.map((d) => d.key) : []);

  return {
    // Resolved through the 115 bridge, not by reading "personal_growth:*"
    // directly: after the flatten those subdomains are unreachable (their
    // parent row is archived, so getUserDomains never queries them) and both
    // sectors would silently vanish. hasArea checks the post-115 top-level
    // key first, then the legacy group form. See lib/domains/area-vocabulary.ts.
    hasFaith: isLegacy || hasArea(domainsState, "faith"),
    hasFitness: isLegacy || hasArea(domainsState, "body"),
    hasWork: isLegacy || activeDomains.has("work"),
    hasSchoolDomain: isLegacy || activeDomains.has("school"),
  };
}
