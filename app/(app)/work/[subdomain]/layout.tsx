import { redirect } from "next/navigation";
import { getUserDomains } from "@/lib/domains/get-user-domains";
import { computeNavDomainState } from "@/lib/shell/nav-domain-state";
import { WorkTabsBar } from "@/components/shell/work-tabs-bar";

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
    userDomains.mode === "domains" ? computeNavDomainState(userDomains.domains, userDomains.subdomains, false).workSubdomains : [];

  if (workSubdomains.length === 0) {
    redirect("/");
  }
  if (!workSubdomains.some((s) => s.key === subdomain)) {
    redirect(`/work/${workSubdomains[0].key}`);
  }

  // WORK-W1: the bar is a client component (edit/reorder/rename are optimistic). The first tab
  // by position is the default; a `business` tab renders the Business screen, a `job` tab Work.
  return (
    <>
      <WorkTabsBar
        tabs={workSubdomains.map((s) => ({ key: s.key, label: s.label, kind: s.kind }))}
        activeKey={subdomain}
      />
      {children}
    </>
  );
}
