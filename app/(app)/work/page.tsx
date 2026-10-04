import { WorkScreen } from "./work-screen";
import { WorkTabsBar } from "@/components/shell/work-tabs-bar";
import { redirect } from "next/navigation";
import { getUserDomains } from "@/lib/domains/get-user-domains";
import { computeNavDomainState } from "@/lib/shell/nav-domain-state";
import { workEntryTarget } from "@/lib/shell/work-tabs";

// WORK-W1b. /work is the Work nav link's fallback: with tabs it hands over to the first tab
// (the default); with ZERO tabs (an account whose Work domain predates tabs) it still serves the
// Work screen, now WITH the tab bar so "Edit tabs -> Add a Business tab" is reachable. Legacy
// accounts (no user_domains rows) keep the plain screen. The screen itself lives in
// work-screen.tsx, shared with /work/[subdomain] (job tabs), so this redirect can't loop.
export default async function WorkPage() {
  const userDomains = await getUserDomains();
  const workSubdomains =
    userDomains.mode === "domains" ? computeNavDomainState(userDomains.domains, userDomains.subdomains, false).workSubdomains : [];
  const target = workEntryTarget(userDomains.mode, workSubdomains);
  if (target.kind === "redirect") redirect(target.href);
  return (
    <>
      {target.kind === "screen-with-bar" ? <WorkTabsBar tabs={[]} activeKey="" showSharedNote={false} /> : null}
      <WorkScreen />
    </>
  );
}
