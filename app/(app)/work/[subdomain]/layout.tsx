import { redirect } from "next/navigation";
import { Briefcase } from "lucide-react";
import { getUserDomains } from "@/lib/domains/get-user-domains";
import { computeNavDomainState } from "@/lib/shell/nav-domain-state";
import { SubdomainTabs, type SubdomainTabItem } from "@/components/shell/subdomain-tabs";
import { AddWorkSubdomainDialog } from "@/components/shell/add-work-subdomain-dialog";

export default async function WorkSubdomainLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  const userDomains = await getUserDomains();

  const workSubdomains =
    userDomains.mode === "domains" ? computeNavDomainState(userDomains.domains, userDomains.subdomains).workSubdomains : [];

  if (workSubdomains.length === 0) {
    redirect("/");
  }
  if (!workSubdomains.some((s) => s.key === subdomain)) {
    redirect(`/work/${workSubdomains[0].key}`);
  }

  const items: SubdomainTabItem[] = workSubdomains.map((s) => ({
    key: s.key,
    href: `/work/${s.key}`,
    label: s.label,
    icon: Briefcase,
    accent: "coop",
    active: s.key === subdomain,
  }));

  return (
    <>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-2 px-4 pt-6 md:px-6 md:pt-8 xl:px-8">
        <div className="flex items-center justify-between gap-2">
          <SubdomainTabs items={items} testIdPrefix="work-subdomain-tab" />
          <AddWorkSubdomainDialog />
        </div>
        {/* Honest, not fake: T-0002 (per-subdomain data scoping on
            coop_targets/coop_tasks) hasn't landed, so every Work subdomain
            currently shows the same shared pipeline/targets/kill-list data
            below, regardless of which tab is selected — flagged here
            rather than silently implying isolation that doesn't exist yet.
            Shown any time there's more than one subdomain to be confused
            between; a single-subdomain account has nothing to conflate. */}
        {items.length > 1 ? (
          <p data-testid="work-shared-data-note" className="text-xs text-muted-foreground">
            Your subdomains share one Work pipeline for now — per-subdomain separation is coming.
          </p>
        ) : null}
      </div>
      {children}
    </>
  );
}
