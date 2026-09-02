import { redirect } from "next/navigation";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { getEveningCloseData } from "./actions";
import { CloseAccountStage } from "@/components/evening-close/close-account-stage";
import { CloseReflectStage } from "@/components/evening-close/close-reflect-stage";

/**
 * The evening close — B1.
 *
 * Structure is (a) account, (b) reflect, (c) plan, and the order is a
 * mechanism, not a flow: lib/evening-close/close-stages.ts owns it so a
 * surface cannot quietly reorder or skip a stage. This page renders (a) and
 * (b); the plan stage waits on migration 119, which gives a dumped item
 * somewhere to be written that isn't a lie about what it is.
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
      <div className="space-y-8">
        <CloseAccountStage blockers={data.blockers} unplannedTodayCount={data.unplannedTodayCount} />
        {/* Reflect renders only once account is satisfied — the stage order is
            a mechanism (close-stages.ts), and showing a later stage beside an
            unresolved blocker is how "you must rewrite this" becomes "you
            should probably rewrite this". */}
        {data.blockers.length === 0 ? <CloseReflectStage todaysThree={data.todaysThree} hoursTodayMinutes={data.hoursTodayMinutes} /> : null}
      </div>
    </PageContainer>
  );
}
