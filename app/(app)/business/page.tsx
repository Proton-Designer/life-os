import { redirect } from "next/navigation";
import { BusinessPageContent } from "@/components/business/business-page-content";
import { getUserDomains } from "@/lib/domains/get-user-domains";
import { computeNavDomainState } from "@/lib/shell/nav-domain-state";
import { businessTabHref } from "@/lib/shell/work-tabs";

// Domains mode with a Business tab on the Work screen: /business lands there (old links,
// notifications and bookmarks keep working). Accounts without one (legacy, or no business
// tab yet) keep this page as it always was.
export default async function BusinessPage() {
  const userDomains = await getUserDomains();
  if (userDomains.mode === "domains") {
    const href = businessTabHref(computeNavDomainState(userDomains.domains, userDomains.subdomains, false).workSubdomains);
    if (href) redirect(href);
  }
  return <BusinessPageContent />;
}
