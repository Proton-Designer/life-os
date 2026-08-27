import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, weekDatesFrom, addDaysToDateString } from "@/lib/date-utils";
import { countScheduledThisWeek } from "@/lib/tasks/schedule-metrics";
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
import { WorkScheduleWeek, type WorkScheduleEvent } from "@/components/work/work-schedule-week";
import { WorkHoursEditorDialog, type PermanentWorkRow, type OneOffWorkRow } from "@/components/work/work-hours-editor-dialog";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";
import { TargetsStrip } from "@/components/co-op/targets-strip";
import { WeeklyAgenda } from "@/components/co-op/weekly-agenda";
import { PipelineBoard } from "@/components/co-op/pipeline-board";
import type { CoopTargetRow, CompletedCoopTargetRow } from "@/lib/coop/targets";
import type { CoopTaskRow } from "@/lib/coop/tasks";

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

  const { data: coopTaskRows } = currentTarget
    ? await supabase
        .from("coop_tasks")
        .select("id, title, deadline, status, blocked_from, created_at")
        .eq("user_id", userId)
        .eq("target_id", currentTarget.id)
    : { data: [] };

  const coopTasks: CoopTaskRow[] = (coopTaskRows ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    deadline: t.deadline,
    status: t.status as CoopTaskRow["status"],
    blockedFrom: t.blocked_from as CoopTaskRow["blockedFrom"],
    createdAt: t.created_at,
  }));

  const eventIds = (eventRows ?? []).map((e) => e.id);
  const [cancelledDates, exceptions] = await Promise.all([
    getCancelledDatesByEvent(supabase, userId, eventIds),
    getScheduleExceptions(supabase, userId, eventIds),
  ]);

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

  const countableEvents = (eventRows ?? []).map((e) => ({
    id: e.id,
    isRecurring: e.is_recurring,
    dayOfWeek: e.day_of_week,
    eventDate: e.event_date,
  }));
  const scheduledThisWeekCount = countScheduledThisWeek(countableEvents, weekDates, cancelledDates);

  return (
    <PageContainer>
      <PageHeader title="Work" />

      <TargetsStrip rows={targets} completedGoals={completedTargets} todayStr={dateStr} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {currentTarget && (
          <Panel id="weekly-agenda" className="scroll-mt-20" title="Weekly Agenda" heroValue={`${coopTasks.length}`} caption={`for ${currentTarget.title}`}>
            <WeeklyAgenda targetId={currentTarget.id} tasks={coopTasks} />
          </Panel>
        )}
        <div className={currentTarget ? "" : "lg:col-span-2"}>
          <Panel
            title="Work schedule"
            heroValue={`${scheduledThisWeekCount}`}
            caption={scheduledThisWeekCount === 0 ? "Nothing scheduled this week" : "shifts this week"}
            controls={
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
            }
          >
            <WorkScheduleWeek events={events} weekDates={weekDates} todayStr={dateStr} />
          </Panel>
        </div>
      </div>

      {currentTarget && (
        <Panel title="Pipeline" caption={`${currentTarget.title} — Backlog through Complete`}>
          <PipelineBoard tasks={coopTasks} />
        </Panel>
      )}
    </PageContainer>
  );
}
