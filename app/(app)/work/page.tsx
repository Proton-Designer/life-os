import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, weekDatesFrom, addDaysToDateString } from "@/lib/date-utils";
import { getCancelledDatesByEvent, getScheduleExceptions, resolveOccurrence } from "@/lib/tasks/schedule-cancellations";
import {
  addWorkHours,
  updateWorkHours,
  removeWorkHours,
  addOneOffWorkShift,
  setWorkHoursOverride,
  removeWorkHoursOverride,
  cancelScheduleOccurrence,
  uncancelScheduleOccurrence,
} from "./actions";
import { WorkScheduleWeek, todayScheduleLabel, type WorkScheduleEvent } from "@/components/work/work-schedule-week";
import { WorkHoursEditorDialog, type PermanentWorkRow, type OneOffWorkRow } from "@/components/work/work-hours-editor-dialog";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";
import { TargetsStrip } from "@/components/co-op/targets-strip";
import { PipelineBoard } from "@/components/co-op/pipeline-board";
import { PipelinePanelControls } from "@/components/co-op/pipeline-panel-controls";
import { PipelineProvider } from "@/components/co-op/pipeline-context";
import type { CoopTargetRow, CompletedCoopTargetRow } from "@/lib/coop/targets";
import { splitByPastComplete, type CoopTaskRow } from "@/lib/coop/tasks";

export default async function CoOpPage() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);
  const weekStart = getWeekStartDate(dateStr);
  const weekDates = weekDatesFrom(weekStart);
  const nextWeekDates = weekDatesFrom(addDaysToDateString(weekStart, 7));

  const [{ data: eventRows }, { data: targetRows }, { data: completedTargetRows }] = await Promise.all([
    supabase
      .from("schedule_events")
      .select("id, is_recurring, day_of_week, event_time, end_time, event_date")
      .eq("user_id", userId)
      .eq("domain", "co_op"),
    supabase
      .from("coop_targets")
      .select("id, title, deadline, position")
      .eq("user_id", userId)
      .eq("status", "active")
      .not("position", "is", null),
    // Completed goals (2026-08-26 evening batch): position is meaningless
    // on a done row (lib/coop/targets.ts's CompletedCoopTargetRow doc
    // comment), so this is ordered by completed_at — most recently
    // finished first, the order that reads correctly for a history list.
    supabase
      .from("coop_targets")
      .select("id, title, completed_at")
      .eq("user_id", userId)
      .eq("status", "done")
      .order("completed_at", { ascending: false }),
  ]);

  const targets: CoopTargetRow[] = (targetRows ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    deadline: t.deadline,
    position: t.position as number,
  }));
  const currentTarget = targets.find((t) => t.position === 1) ?? null;

  const completedTargets: CompletedCoopTargetRow[] = (completedTargetRows ?? [])
    .filter((t) => t.completed_at !== null)
    .map((t) => ({
      id: t.id,
      title: t.title,
      completedDateStr: localDateString(new Date(t.completed_at as string), timezone),
    }));

  // Wave 2: coop_tasks depends on currentTarget.id from wave 1, and the
  // cancellations/exceptions pair depends on eventIds from wave 1 — but
  // neither depends on the OTHER's result, so they run concurrently
  // instead of one after the other (Lead's latency diagnosis, batch 5,
  // item 1: this was a third sequential Supabase round trip for no reason).
  const eventIds = (eventRows ?? []).map((e) => e.id);
  const [{ data: coopTaskRows }, cancelledDates, exceptions] = await Promise.all([
    currentTarget
      ? supabase
          .from("coop_tasks")
          .select("id, title, deadline, status, blocked_from, created_at, completed_at")
          .eq("user_id", userId)
          .eq("target_id", currentTarget.id)
      : Promise.resolve({ data: [] as never[] }),
    getCancelledDatesByEvent(supabase, userId, eventIds),
    getScheduleExceptions(supabase, userId, eventIds),
  ]);

  const coopTasks: CoopTaskRow[] = (coopTaskRows ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    deadline: t.deadline,
    status: t.status as CoopTaskRow["status"],
    blockedFrom: t.blocked_from as CoopTaskRow["blockedFrom"],
    createdAt: t.created_at,
    completedAt: t.completed_at,
  }));
  const { pipelineTasks, pastTasks } = splitByPastComplete(coopTasks, now, timezone);

  const events: WorkScheduleEvent[] = (eventRows ?? []).map((e) => ({
    id: e.id,
    isRecurring: e.is_recurring,
    dayOfWeek: e.day_of_week,
    eventDate: e.event_date,
    eventTime: e.event_time,
    endTime: e.end_time,
    cancelledDates: Array.from(cancelledDates.get(e.id) ?? []),
    overrides: (() => {
      const byDate = exceptions.get(e.id);
      if (!byDate) return [];
      return Array.from(byDate.entries())
        .filter(([, ex]) => ex.override !== null)
        .map(([date, ex]) => ({ date, eventTime: ex.override!.eventTime, endTime: ex.override!.endTime }));
    })(),
  }));

  const permanentRows: PermanentWorkRow[] = (eventRows ?? [])
    .filter((e) => e.is_recurring && e.day_of_week !== null)
    .map((e) => ({ id: e.id, dayOfWeek: e.day_of_week as number, eventTime: e.event_time, endTime: e.end_time }));
  const oneOffRows: OneOffWorkRow[] = (eventRows ?? [])
    .filter((e) => !e.is_recurring && e.event_date !== null)
    .map((e) => ({ id: e.id, eventDate: e.event_date as string, eventTime: e.event_time, endTime: e.end_time }));

  return (
    <PageContainer>
      <PageHeader title="Work" />

      {/* Thin schedule strip (batch 5, item 2) — replaces the old "Work
          schedule" Panel entirely; deliberately not a <Panel>, since
          wrapping it in one is what made it a module again. No shift
          count anywhere (Ayman was explicit). Every text child gets
          min-w-0 and the row wraps rather than compresses at mobile
          widths — four things across one un-wrapping row is exactly the
          320px overflow AGENTS.md's task-list-module note warns about. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/40 bg-card px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-sm font-medium">Work schedule</span>
          <span className="min-w-0 truncate text-sm text-muted-foreground">{todayScheduleLabel(events, weekDates, dateStr)}</span>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <WorkScheduleWeek events={events} weekDates={weekDates} todayStr={dateStr} compact />
        </div>
        <WorkHoursEditorDialog
          permanentRows={permanentRows}
          oneOffRows={oneOffRows}
          weekDates={weekDates}
          nextWeekDates={nextWeekDates}
          exceptions={exceptions}
          actions={{
            addWorkHours,
            updateWorkHours,
            removeWorkHours,
            addOneOffWorkShift,
            setWorkHoursOverride,
            removeWorkHoursOverride,
            cancelScheduleOccurrence,
            uncancelScheduleOccurrence,
          }}
        />
      </div>

      <TargetsStrip rows={targets} completedGoals={completedTargets} todayStr={dateStr} />

      {currentTarget && (
        <PipelineProvider targetId={currentTarget.id} initialTasks={pipelineTasks}>
          <Panel
            id="work-pipeline"
            className="scroll-mt-20"
            title="Weekly Agenda Pipeline"
            caption={`${currentTarget.title} — Backlog through Complete`}
            controls={<PipelinePanelControls />}
          >
            <PipelineBoard pastTasks={pastTasks} />
          </Panel>
        </PipelineProvider>
      )}
    </PageContainer>
  );
}
