import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString, getWeekStartDate, weekDatesFrom, addDaysToDateString } from "@/lib/date-utils";
import { getCancelledDatesByEvent, getScheduleExceptions } from "@/lib/tasks/schedule-cancellations";
import { splitByPastComplete, type CoopTaskRow } from "@/lib/coop/tasks";
import type { CoopTargetRow, CompletedCoopTargetRow } from "@/lib/coop/targets";
import type { WorkScheduleEvent } from "@/components/work/work-schedule-week";
import type { PermanentWorkRow, OneOffWorkRow } from "@/components/work/work-hours-editor-dialog";

/**
 * Everything the Work modules (schedule strip, targets & goals, weekly agenda pipeline) render, as data. Extracted from
 * WorkScreen so the SAME modules can also be switched on in the Business page's widget manager (off there by default).
 */
export type WorkModulesData = {
  dateStr: string;
  timezone: string;
  weekDates: string[];
  nextWeekDates: string[];
  events: WorkScheduleEvent[];
  permanentRows: PermanentWorkRow[];
  oneOffRows: OneOffWorkRow[];
  exceptions: Awaited<ReturnType<typeof getScheduleExceptions>>;
  targets: CoopTargetRow[];
  completedTargets: CompletedCoopTargetRow[];
  currentTarget: CoopTargetRow | null;
  pipelineTasks: CoopTaskRow[];
  pastTasks: CoopTaskRow[];
};

export async function loadWorkModulesData(supabase: SupabaseClient, userId: string, now: Date, timezone: string): Promise<WorkModulesData> {
  const dateStr = localDateString(now, timezone);
  const weekStart = getWeekStartDate(dateStr);
  const weekDates = weekDatesFrom(weekStart);
  const nextWeekDates = weekDatesFrom(addDaysToDateString(weekStart, 7));

  const [{ data: eventRows }, { data: targetRows }, { data: completedTargetRows }] = await Promise.all([
    supabase.from("schedule_events").select("id, is_recurring, day_of_week, event_time, end_time, event_date").eq("user_id", userId).eq("domain", "co_op"),
    supabase.from("coop_targets").select("id, title, deadline, position").eq("user_id", userId).eq("status", "active").not("position", "is", null),
    // Completed goals: position is meaningless on a done row (CompletedCoopTargetRow's doc), so ordered by completed_at, newest first.
    supabase.from("coop_targets").select("id, title, completed_at").eq("user_id", userId).eq("status", "done").order("completed_at", { ascending: false }),
  ]);

  const targets: CoopTargetRow[] = (targetRows ?? []).map((t) => ({ id: t.id, title: t.title, deadline: t.deadline, position: t.position as number }));
  const currentTarget = targets.find((t) => t.position === 1) ?? null;
  const completedTargets: CompletedCoopTargetRow[] = (completedTargetRows ?? [])
    .filter((t) => t.completed_at !== null)
    .map((t) => ({ id: t.id, title: t.title, completedDateStr: localDateString(new Date(t.completed_at as string), timezone) }));

  // coop_tasks depends on currentTarget.id and the cancellations/exceptions pair on the event ids, but neither on the other: concurrent.
  const eventIds = (eventRows ?? []).map((e) => e.id);
  const [{ data: coopTaskRows }, cancelledDates, exceptions] = await Promise.all([
    currentTarget
      ? supabase
          .from("coop_tasks")
          .select("id, title, deadline, status, blocked_from, blocked_reason, blocked_since, created_at, completed_at")
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
    blockedReason: t.blocked_reason,
    blockedSince: t.blocked_since,
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

  return { dateStr, timezone, weekDates, nextWeekDates, events, permanentRows, oneOffRows, exceptions, targets, completedTargets, currentTarget, pipelineTasks, pastTasks };
}
