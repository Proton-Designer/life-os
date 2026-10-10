import { saveWeeklyGoal } from "@/app/(app)/actions";
import { KillList } from "@/components/business/kill-list";
import { killListTarget } from "@/lib/business/kill-list-target";
import { KillListModuleControls } from "@/components/business/kill-list-module-controls";
import { IncompleteTasksModule } from "@/components/business/incomplete-tasks-module";
import { WeeklyGoalSlot } from "@/components/shared/weekly-goal-slot";
import { CompletedGoalsArchive } from "@/components/business/completed-goals-archive";
import { FocusTimeCard } from "@/components/business/focus-time-card";
import { Panel } from "@/components/ui/panel";
import { LayoutSlot, type LayoutMap } from "@/components/page-layout/layout-slot";
import type { BusinessModulesData } from "@/lib/business/business-modules-data";

/**
 * The five Business modules, each in its own LayoutSlot. Rendered by the Business screen (on by default) AND by the Work
 * screen (off by default, switched on in its widget manager); `layout` is the HOST page's own layout map, so a module added
 * to Work is stored under Work's layout and never shows up on, or changes, the Business page.
 */
export function BusinessModules({ data, layout }: { data: BusinessModulesData; layout: LayoutMap }) {
  const { slots, dateStr } = data;
  const killListDone = slots.filter((s) => s.completed).length;
  const killListTotal = killListTarget(slots);

  return (
    <>
      {/* Restructure (2026-08-26, per Ayman): the Lock In button lives inside the Focus time module, minutes to its left. */}
      <LayoutSlot layout={layout} widgetKey="focus_time">
        <FocusTimeCard
          sessionsTodayCount={data.sessionsTodayCount}
          focusMinutesToday={data.focusMinutesToday}
        />
      </LayoutSlot>
      <LayoutSlot layout={layout} widgetKey="incomplete_tasks">
        <IncompleteTasksModule initialGroups={data.incompleteByDate} todayStr={dateStr} />
      </LayoutSlot>

      <LayoutSlot layout={layout} widgetKey="kill_list">
        <div id="kill-list" className="scroll-mt-20">
          {/* Two slots are the day's commitment; the third is dimmed and optional (2026-10-05, per Ayman): the target is 2, or 3 once the optional one is filled. */}
          <Panel
            title="Today's kill list"
            heroValue={`${killListDone}/${killListTotal}`}
            caption={killListDone >= killListTotal ? (killListTotal === 2 ? "Both cleared" : "All three cleared") : `${killListTotal - killListDone} left today`}
            controls={<KillListModuleControls />}
          >
            <KillList date={dateStr} slots={slots} />
          </Panel>
        </div>
      </LayoutSlot>
      <LayoutSlot layout={layout} widgetKey="weekly_goal">
        {/* IA-P1b: displays the one shared weekly-goal editor (Home, /calendar and the topbar popup open the same one). */}
        <div className="rounded-2xl border border-border/40 bg-card p-4" data-testid="business-weekly-goal">
          <WeeklyGoalSlot domain="business" goal={data.weeklyGoal} onSave={saveWeeklyGoal.bind(null, "business")} />
          {!data.weeklyGoal.headline.trim() ? (
            <p className="mt-2 text-xs text-muted-foreground">The one outcome this week is actually about — everything else should serve it.</p>
          ) : null}
        </div>
      </LayoutSlot>

      <LayoutSlot layout={layout} widgetKey="completed_goals_archive">
        <CompletedGoalsArchive goals={data.completedGoals} todayStr={dateStr} />
      </LayoutSlot>
    </>
  );
}
