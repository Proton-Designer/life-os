import { redirect } from "next/navigation";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { getEveningCloseData } from "./actions";
import { CloseAccountStage } from "@/components/evening-close/close-account-stage";

/**
 * The evening close — B1.
 *
 * Structure is (a) account, (b) reflect, (c) plan, and the order is a
 * mechanism, not a flow: lib/evening-close/close-stages.ts owns it so a
 * surface cannot quietly reorder or skip a stage. This page currently renders
 * stage (a) only; reflect and plan follow.
 *
 * The account stage is where the ceremony is allowed to REFUSE. Everything
 * else about the close is encouragement; this one thing is a gate, because a
 * plan skipped three times and never once followed should not be silently
 * re-confirmed for another night.
 */
export default async function EveningClosePage() {
  const data = await getEveningCloseData();
  if (data === null) redirect("/login");

  return (
    <PageContainer>
      <PageHeader title="Evening close" />
      <CloseAccountStage blockers={data.blockers} unplannedTodayCount={data.unplannedTodayCount} />
    </PageContainer>
  );
}
