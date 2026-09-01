import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { getOnboardingState } from "@/app/(app)/onboarding/actions";
import type { DomainKey, FaithConfig } from "@/components/onboarding/types";
import { isIngestionAvailable } from "@/lib/self-mastery/ingestion-availability";

// AC#5: a user who abandons mid-flow must re-enter where the data says, not
// blindly at step 1 — resolved here (data fetch) rather than inside the
// client wizard, so the resume state is a plain serializable prop, not a
// client-side effect racing the first paint.
export default async function OnboardingPage() {
  const { domains, subdomains } = await getOnboardingState();

  const initialSelectedDomains = domains
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((d) => d.key) as DomainKey[];

  const domainsWithData = Array.from(new Set(subdomains.map((s) => s.domainKey))) as DomainKey[];

  const faithRow = subdomains.find((s) => s.domainKey === "personal_growth" && s.key === "faith");
  const initialFaithConfig = (faithRow?.config as unknown as FaithConfig | undefined) ?? null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <OnboardingWizard
        ingestionAvailable={isIngestionAvailable()}
        initialSelectedDomains={initialSelectedDomains}
        domainsWithData={domainsWithData}
        initialFaithConfig={initialFaithConfig}
      />
    </main>
  );
}
