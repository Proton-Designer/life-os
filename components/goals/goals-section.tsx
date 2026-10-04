import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { loadGoalBoardData } from "@/lib/goals/board-data";
import { GoalBoard } from "@/components/goals/goal-board";
import { getPageLayout } from "@/app/(app)/page-layout-actions";
import { LayoutSlot, buildLayoutMap, allWidgetsHidden } from "@/components/page-layout/layout-slot";
import { WidgetManagerButton } from "@/components/page-layout/widget-manager-button";

/** The monthly goal board (moved out of /goals by IA-P3a; /week step 2). Same readers, Deen filter and widget layout ("goals") as before. */
export async function GoalsSection() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const profile = await getProfile();
  const [board, layout] = await Promise.all([loadGoalBoardData(supabase, user.id, profile), getPageLayout("goals")]);
  const layoutMap = buildLayoutMap(layout);

  return (
    <div className="space-y-4" data-testid="goals-section">
      <div className="flex justify-end">
        <WidgetManagerButton domainKey="goals" />
      </div>
      {allWidgetsHidden(layout) ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          Every widget on this page is hidden. <WidgetManagerButton domainKey="goals" variant="text" />
        </div>
      ) : null}
      <LayoutSlot layout={layoutMap} widgetKey="goal_board">
        <GoalBoard {...board} />
      </LayoutSlot>
    </div>
  );
}
