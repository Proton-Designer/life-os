import {
  addWorkHours,
  updateWorkHours,
  removeWorkHours,
  addOneOffWorkShift,
  setWorkHoursOverride,
  removeWorkHoursOverride,
  cancelScheduleOccurrence,
  uncancelScheduleOccurrence,
} from "@/app/(app)/work/actions";
import { WorkScheduleWeek, todayScheduleLabel } from "@/components/work/work-schedule-week";
import { WorkHoursEditorDialog } from "@/components/work/work-hours-editor-dialog";
import { TargetsStrip } from "@/components/co-op/targets-strip";
import { PipelineBoard } from "@/components/co-op/pipeline-board";
import { PipelinePanelControls } from "@/components/co-op/pipeline-panel-controls";
import { PipelineProvider } from "@/components/co-op/pipeline-context";
import { Panel } from "@/components/ui/panel";
import { LayoutSlot, type LayoutMap } from "@/components/page-layout/layout-slot";
import type { WorkModulesData } from "@/lib/work/work-modules-data";

/**
 * The three Work modules, each in its own LayoutSlot. Rendered by the Work screen (on by default) AND by the Business screen
 * (off by default, switched on in its widget manager). `layout` is the HOST page's own layout map, so a module added to
 * Business is stored under Business's layout and never shows up on, or changes, the Work page.
 */
export function WorkModules({ data, layout }: { data: WorkModulesData; layout: LayoutMap }) {
  const { events, weekDates, nextWeekDates, dateStr, currentTarget } = data;
  return (
    <>
      <LayoutSlot layout={layout} widgetKey="work_schedule">
        {/* Thin schedule strip (batch 5, item 2): deliberately not a <Panel>. No shift count anywhere (Ayman was explicit).
            Every text child gets min-w-0 and the row wraps rather than compresses at mobile widths. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/40 bg-card px-3 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="shrink-0 text-sm font-medium">Work schedule</span>
            <span className="min-w-0 truncate text-sm text-muted-foreground">{todayScheduleLabel(events, weekDates, dateStr)}</span>
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <WorkScheduleWeek events={events} weekDates={weekDates} todayStr={dateStr} compact />
          </div>
          <WorkHoursEditorDialog
            permanentRows={data.permanentRows}
            oneOffRows={data.oneOffRows}
            weekDates={weekDates}
            nextWeekDates={nextWeekDates}
            exceptions={data.exceptions}
            actions={{ addWorkHours, updateWorkHours, removeWorkHours, addOneOffWorkShift, setWorkHoursOverride, removeWorkHoursOverride, cancelScheduleOccurrence, uncancelScheduleOccurrence }}
          />
        </div>
      </LayoutSlot>

      <LayoutSlot layout={layout} widgetKey="targets">
        <TargetsStrip rows={data.targets} completedGoals={data.completedTargets} todayStr={dateStr} />
      </LayoutSlot>

      <LayoutSlot layout={layout} widgetKey="pipeline">
        {currentTarget && (
          <PipelineProvider targetId={currentTarget.id} initialTasks={data.pipelineTasks} timezone={data.timezone}>
            <Panel
              id="work-pipeline"
              className="scroll-mt-20"
              title="Weekly Agenda Pipeline"
              caption={`${currentTarget.title} — Backlog through Complete`}
              controls={<PipelinePanelControls />}
            >
              <PipelineBoard pastTasks={data.pastTasks} />
            </Panel>
          </PipelineProvider>
        )}
      </LayoutSlot>
    </>
  );
}
