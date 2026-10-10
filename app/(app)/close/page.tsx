import { redirect } from "next/navigation";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { getEveningCloseData } from "./actions";
import { CloseAccountStage } from "@/components/evening-close/close-account-stage";
import { CloseReflectStage } from "@/components/evening-close/close-reflect-stage";
import { ClosePlanStage } from "@/components/evening-close/close-plan-stage";
import { QuranCloseLine } from "@/components/evening-close/quran-close-line";
import { getQuranOverviewCore, type QuranOverview } from "@/lib/quran/plan-core";
import { closeLine } from "@/lib/quran/surfaces";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { effectiveDayString } from "@/lib/date-utils";
import { Stream } from "@/components/home/stream";
import { PanelSkeleton } from "@/components/shell/route-skeleton";
import { VerdictDueList } from "@/components/promotions/verdict-card";
import { getDuePromotions } from "@/lib/promotions/read";
import { loadCloseInbox } from "@/lib/inbox/close-inbox";

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
  // NAV-01b: promotions and the Inbox start now and stream in; the Account stage and the rest paint first.
  const duePromotionsPromise = getDuePromotions();
  // QURAN-02: the khatm plan's one read for the close's Quran line (Deen ON only), for the day being CLOSED.
  const quranPromise: Promise<QuranOverview | null> = (async () => {
    const profile = await getProfile();
    if (!isDeenModeOn(profile)) return null;
    const user = await getAuthedUser();
    if (!user) return null;
    return getQuranOverviewCore(await createClient(), user.id, effectiveDayString(new Date(), profile?.timezone ?? "UTC"));
  })().catch(() => null);
  const inboxPromise = data.blockers.length === 0 ? loadCloseInbox() : Promise.resolve(null);
  for (const p of [duePromotionsPromise, inboxPromise, quranPromise]) p.catch(() => undefined);

  return (
    <PageContainer>
      <PageHeader title="Evening close" />
      <div className="space-y-8">
        <CloseAccountStage
          blockers={data.blockers}
          blockingItems={data.blockingItems}
          reviewGroups={data.reviewGroups}
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
              deltaMinutes={data.deltaMinutes}
              activeHabits={data.activeHabits}
            />
            <Stream promise={quranPromise} label="Quran" fallback={null}>
              {(quran) => <QuranCloseLine line={closeLine(quran)} />}
            </Stream>
            <Stream promise={duePromotionsPromise} label="Promotions" fallback={null}>
              {(duePromotions) => <VerdictDueList promotions={duePromotions} />}
            </Stream>
            <Stream promise={inboxPromise} label="Plan tomorrow" fallback={<PanelSkeleton titleWidth="w-28" bodyHeight="h-48" />}>
              {(inbox) => (
                <ClosePlanStage
                  initialLines={data.tomorrowLines}
                  seeds={data.planSeeds}
                  mode="tonight"
                  inbox={inbox?.items}
                  inboxAreas={inbox?.areas}
                  killList={inbox?.killList}
                  areas={inbox?.planAreas}
                  workTabs={inbox?.planWorkTabs}
                  timezone={inbox?.timezone}
                />
              )}
            </Stream>
          </>
        ) : null}
      </div>
    </PageContainer>
  );
}
