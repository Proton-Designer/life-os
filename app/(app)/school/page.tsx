import { redirect } from "next/navigation";
import { CalendarClock, AlertTriangle, ShieldCheck, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, weekDatesFrom, addDaysToDateString, resolveLocalTime } from "@/lib/date-utils";
import { countOverdue, countCompletedInWeek } from "@/lib/tasks/task-metrics";
import { countScheduledThisWeek } from "@/lib/tasks/schedule-metrics";
import { getCancelledDatesByEvent } from "@/lib/tasks/schedule-cancellations";
import { accentForActivityCount } from "@/lib/kpi-value-accent";
import {
  addTask,
  toggleTask,
  removeTask,
  addScheduleEvent,
  cancelScheduleOccurrence,
  uncancelScheduleOccurrence,
} from "./actions";
import type { TaskRowItem } from "@/components/shared/task-row-list";
import { SchoolTaskPanel } from "@/components/school/task-panel";
import { DeadlineList } from "@/components/shared/deadline-list";
import { DomainScheduleView, type ScheduleEventData } from "@/components/shared/domain-schedule-view";
import { ClassScheduleWeek, type ClassScheduleEvent } from "@/components/school/class-schedule-week";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Panel } from "@/components/ui/panel";

type TaskData = { id: string; title: string; dueDate: string | null; dueTime: string | null; completed: boolean };

export default async function SchoolPage() {
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
  const weekEndIso = `${addDaysToDateString(weekStart, 7)}T00:00:00.000Z`;
  const weekStartIso = `${weekStart}T00:00:00.000Z`;

  const [{ data: taskRows }, { data: eventRows }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, due_date, due_time, completed, completed_at")
      .eq("user_id", userId)
      .eq("domain", "school")
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("schedule_events")
      .select("id, title, is_recurring, day_of_week, event_time, end_time, location, instructor, event_date")
      .eq("user_id", userId)
      .eq("domain", "school"),
  ]);

  const allTasks = taskRows ?? [];
  const openTasks: TaskData[] = allTasks
    .filter((t) => !t.completed)
    .map((t) => ({ id: t.id, title: t.title, dueDate: t.due_date, dueTime: t.due_time, completed: t.completed }));
  const deadlineTasks = openTasks
    .filter((t): t is TaskData & { dueDate: string } => t.dueDate !== null)
    .map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, dueTime: t.dueTime }));

  // Today's completed tasks for the task list's Completed section — new
  // data (the list previously fetched/rendered openTasks only). Bounds are
  // the LOCAL day resolved through the profile's timezone, not a naive UTC
  // string range (the exact class of bug Item A fixed for prayer windows —
  // see resolveLocalTime's own callers in get-day-shape.ts).
  const todayStartIso = resolveLocalTime(dateStr, "00:00", timezone).toISOString();
  const todayEndIso = resolveLocalTime(addDaysToDateString(dateStr, 1), "00:00", timezone).toISOString();
  const completedTodayTasks = allTasks
    .filter(
      (t): t is typeof t & { completed_at: string } =>
        t.completed && t.completed_at !== null && t.completed_at >= todayStartIso && t.completed_at < todayEndIso
    )
    .sort((a, b) => (a.completed_at < b.completed_at ? -1 : 1));

  const taskRowItems: TaskRowItem[] = [
    ...openTasks.map(
      (t): TaskRowItem => ({ id: t.id, title: t.title, domain: "school", meta: t.dueDate ?? undefined, mode: "toggle" })
    ),
    ...completedTodayTasks.map(
      (t): TaskRowItem => ({ id: t.id, title: t.title, domain: "school", mode: "toggle", completedAtIso: t.completed_at })
    ),
  ];

  const cancelledDates = await getCancelledDatesByEvent(
    supabase,
    userId,
    (eventRows ?? []).map((e) => e.id)
  );

  const events: ScheduleEventData[] = (eventRows ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    isRecurring: e.is_recurring,
    dayOfWeek: e.day_of_week,
    eventTime: e.event_time,
    eventDate: e.event_date,
    cancelledDates: Array.from(cancelledDates.get(e.id) ?? []),
  }));

  // The richer week view (§3: time range, room, instructor) only covers
  // recurring classes — a one-off event has no day_of_week to place it on.
  const classScheduleEvents: ClassScheduleEvent[] = (eventRows ?? [])
    .filter((e) => e.is_recurring && e.day_of_week !== null)
    .map((e) => ({
      id: e.id,
      title: e.title,
      dayOfWeek: e.day_of_week as number,
      eventTime: e.event_time,
      endTime: e.end_time,
      location: e.location,
      instructor: e.instructor,
      cancelledDates: Array.from(cancelledDates.get(e.id) ?? []),
    }));

  const dueTodayCount = openTasks.filter((t) => t.dueDate === dateStr).length;
  const overdueCount = countOverdue(
    allTasks.map((t) => ({ dueDate: t.due_date, completed: t.completed })),
    dateStr
  );
  const completedThisWeekCount = countCompletedInWeek(
    allTasks.map((t) => ({ completedAt: t.completed_at })),
    weekStartIso,
    weekEndIso
  );
  const dueThisWeekCount = deadlineTasks.filter((t) => weekDates.includes(t.dueDate)).length;
  const scheduledThisWeekCount = countScheduledThisWeek(events, weekDates, cancelledDates);

  return (
    <PageContainer>
      <PageHeader title="School" />

      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-3">
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={CalendarClock}
            // Opus Lead review (2026-08-16): the first KPI card is the
            // screen's identity anchor and keeps the domain accent
            // unconditionally — only the other two take state-based tint.
            accent="school"
            label="Due today"
            value={`${dueTodayCount}`}
            caption={dueTodayCount === 0 ? "Nothing due today" : `${dueTodayCount} task${dueTodayCount === 1 ? "" : "s"} due`}
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={overdueCount === 0 ? ShieldCheck : AlertTriangle}
            accent={overdueCount === 0 ? "business" : "warning"}
            label="Overdue"
            value={`${overdueCount}`}
            caption={overdueCount === 0 ? "Nothing overdue" : "Needs attention"}
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={CheckCircle2}
            accent={accentForActivityCount(completedThisWeekCount)}
            label="Completed this week"
            value={`${completedThisWeekCount}`}
            caption={completedThisWeekCount === 0 ? "Nothing completed yet this week" : "Keep it up"}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <Panel title="Deadlines" heroValue={`${dueThisWeekCount}`} caption="due this week">
            <DeadlineList tasks={deadlineTasks} todayStr={dateStr} toggleTask={toggleTask} />
          </Panel>
        </div>
        <div className="lg:col-span-6">
          <Panel
            title="Class schedule"
            heroValue={`${scheduledThisWeekCount}`}
            caption={scheduledThisWeekCount === 0 ? "Nothing scheduled this week" : "classes this week"}
          >
            <DomainScheduleView
              events={events}
              weekDates={weekDates}
              addScheduleEvent={addScheduleEvent}
              cancelScheduleOccurrence={cancelScheduleOccurrence}
              uncancelScheduleOccurrence={uncancelScheduleOccurrence}
            />
          </Panel>
        </div>
      </div>

      <Panel title="This week's classes">
        <ClassScheduleWeek events={classScheduleEvents} weekDates={weekDates} todayStr={dateStr} />
      </Panel>

      <Panel id="tasks" className="scroll-mt-20" title="Task list" heroValue={`${openTasks.length}`} caption="open">
        <SchoolTaskPanel items={taskRowItems} addTask={addTask} toggleTask={toggleTask} removeTask={removeTask} />
      </Panel>
    </PageContainer>
  );
}
