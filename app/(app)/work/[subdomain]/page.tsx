import { WorkScreen as WorkPage } from "../work-screen";
import { BusinessPageContent } from "@/components/business/business-page-content";
import { getUserDomains } from "@/lib/domains/get-user-domains";

// WORK-W1: the tab's `kind` picks the screen. A business tab renders the Business screen
// (one shared component, components/business/business-page-content.tsx); a job tab composes
// the existing /work route unchanged (M5: adapt, don't rewrite). Extra tabs of the same
// kind share data for now (T-0002, per-tab scoping, hasn't landed): see the note in
// [subdomain]/layout.tsx.
export default async function WorkSubdomainPage({ params }: { params: Promise<{ subdomain: string }> }) {
  const { subdomain } = await params;
  const userDomains = await getUserDomains();
  const kind =
    userDomains.mode === "domains"
      ? userDomains.subdomains.find((s) => s.domainKey === "work" && s.key === subdomain)?.kind ?? null
      : null;
  if (kind === "business") return <BusinessPageContent />;
  return <WorkPage />;
}
