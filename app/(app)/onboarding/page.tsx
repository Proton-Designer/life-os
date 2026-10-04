import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { getOnboardingState } from "@/app/(app)/onboarding/actions";
import type { DomainKey } from "@/components/onboarding/types";

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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <OnboardingWizard
        initialSelectedDomains={initialSelectedDomains}
        domainsWithData={domainsWithData}
      />
    </main>
  );
}
