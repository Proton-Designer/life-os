import { redirect } from "next/navigation";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { listGoalsForMonth } from "@/lib/goals/actions-core";
import { getMilestonesForMonth, monthStartFor } from "@/lib/goals/queries";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { withoutDeenGoals } from "@/lib/goals/deen-filter";
import { GoalBoard } from "@/components/goals/goal-board";
import { getPageLayout } from "@/app/(app)/page-layout-actions";
import { LayoutSlot, buildLayoutMap, allWidgetsHidden } from "@/components/page-layout/layout-slot";
import { WidgetManagerButton } from "@/components/page-layout/widget-manager-button";

/**
 * The Goals page (#43/#44) — the first real reader for
 * `lib/goals/actions-core.ts`'s full CRUD, which had zero callers before
 * this. See that file's header and migration 165 for the schema reasoning
 * (a ranked, cross-domain monthly portfolio, not a reshape of
 * `weekly_goals`).
 *
 * `monthStart` is derived from `localDateString(now, tz)` (never a raw
 * `Date` — CLAUDE.md's hard constraint), sliced to the first of the month
 * via `monthStartFor`, the same pure-string-arithmetic helper #45's Night
 * Plan seeding query already uses.
 */
export default async function GoalsPage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const now = new Date();
  const todayStr = localDateString(now, timezone);
  const monthStart = monthStartFor(todayStr);

  const deenMode = isDeenModeOn(profile);
  const [allGoals, allMilestones, layout] = await Promise.all([
    listGoalsForMonth(supabase, user.id, monthStart),
    getMilestonesForMonth(supabase, user.id, monthStart),
    getPageLayout("goals"),
  ]);
  // Deen Mode OFF: goals tagged "deen" (and their milestones) are not shown --
  // user-authored religious text included. Data untouched; ON shows them as before.
  const goals = withoutDeenGoals(allGoals, deenMode);
  const hiddenGoals = allGoals.filter((g) => !goals.includes(g));
  const hiddenGoalIds = new Set(hiddenGoals.map((g) => g.id));
  const milestones = allMilestones.filter((m) => !hiddenGoalIds.has(m.goalId));
  // Ranks still held by hidden goals stay unavailable in the add form (the DB's per-month rank index is not a UI concern).
  const reservedRanks = hiddenGoals.filter((g) => g.status === "active").map((g) => g.rank);
  const layoutMap = buildLayoutMap(layout);

  return (
    <PageContainer>
      <PageHeader title="Goals" actions={<WidgetManagerButton domainKey="goals" />} />
      {allWidgetsHidden(layout) ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          Every widget on this page is hidden. <WidgetManagerButton domainKey="goals" variant="text" />
        </div>
      ) : null}
      <LayoutSlot layout={layoutMap} widgetKey="goal_board">
        <GoalBoard deenMode={deenMode} reservedRanks={reservedRanks} monthStart={monthStart} todayStr={todayStr} goals={goals} milestones={milestones} />
      </LayoutSlot>
    </PageContainer>
  );
}
