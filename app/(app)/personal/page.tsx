import { redirect } from "next/navigation";
import { getUserDomains } from "@/lib/domains/get-user-domains";
import { computeNavDomainState } from "@/lib/shell/nav-domain-state";

// The Personal tab has no content of its own — it always redirects into
// whichever subdomain the user kept, in the order they kept them.
export default async function PersonalIndexPage() {
  const userDomains = await getUserDomains();
  const kept =
    userDomains.mode === "domains"
      ? computeNavDomainState(userDomains.domains, userDomains.subdomains).personalSubdomains
      : [];

  redirect(kept.length > 0 ? `/personal/${kept[0].key}` : "/");
}
