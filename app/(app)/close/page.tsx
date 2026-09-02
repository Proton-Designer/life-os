import { redirect } from "next/navigation";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { getEveningCloseData } from "./actions";
import { CloseAccountStage } from "@/components/evening-close/close-account-stage";
import { CloseReflectStage } from "@/components/evening-close/close-reflect-stage";
import { ClosePlanStage } from "@/components/evening-close/close-plan-stage";
import { VerdictDueList } from "@/components/promotions/verdict-card";
import { getDuePromotions } from "@/lib/promotions/read";

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

  // Renders NOTHING when nothing is due — no card, no empty state. Most nights
  // this is empty and the close should be exactly as long as it was before
  // promotions existed, so there is no wrapper and no heading here: the
  // component supplies its own <h3>.
  const duePromotions = await getDuePromotions();

  return (
    <PageContainer>
      <PageHeader title="Evening close" />
      <div className="space-y-8">
        <CloseAccountStage
          blockers={data.blockers}
          blockingItems={data.blockingItems}
          unplannedTodayCount={data.unplannedTodayCount}
        />
        {/* Reflect renders only once account is satisfied — the stage order is
            a mechanism (close-stages.ts), and showing a later stage beside an
            unresolved blocker is how "you must rewrite this" becomes "you
            should probably rewrite this". */}
        {data.blockers.length === 0 ? (
          <>
            <CloseReflectStage
              todaysThree={data.todaysThree}
              hoursTodayMinutes={data.hoursTodayMinutes}
              weekdayBaselines={data.weekdayBaselines}
              weekdayIndex={data.weekdayIndex}
            />
            <VerdictDueList promotions={duePromotions} />
            <ClosePlanStage initialLines={data.tomorrowLines} />
          </>
        ) : null}
      </div>
    </PageContainer>
  );
}
