import { redirect } from "next/navigation";
import { CalendarClock, AlertTriangle, ShieldCheck, CalendarCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, weekDatesFrom, addDaysToDateString, resolveLocalTime } from "@/lib/date-utils";
import { countScheduledThisWeek } from "@/lib/tasks/schedule-metrics";
import { getCancelledDatesByEvent, isOccurrenceCancelled } from "@/lib/tasks/schedule-cancellations";
import { TASK_TYPE_LABEL } from "@/lib/tasks/task-type";
import { groupCompletedTasksByWeek } from "@/lib/tasks/completed-by-week";
import type { TaskType } from "@/lib/tasks/actions-core";
import {
  addTask,
  toggleTask,
  removeTask,
  addClassEvent,
  updateClassEvent,
  removeClassEvent,
  cancelScheduleOccurrence,
  uncancelScheduleOccurrence,
} from "./actions";
import type { TaskRowItem } from "@/components/shared/task-row-list";
import { SchoolTaskPanel } from "@/components/school/task-panel";
import { DeadlineList } from "@/components/shared/deadline-list";
import { ClassScheduleWeek, type ClassScheduleEvent } from "@/components/school/class-schedule-week";
import { ClassEditorDialog, type ClassGroup } from "@/components/school/class-editor-dialog";
import { KpiTaskDialog } from "@/components/school/kpi-task-dialog";
import { CompletedTasksDialog, type CompletedWeekGroup } from "@/components/school/completed-tasks-dialog";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Panel } from "@/components/ui/panel";

type TaskData = {
  id: string;
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  completed: boolean;
  createdAt: string;
  taskType: TaskType | null;
  classEventId: string | null;
};

function formatTaskMeta(taskType: TaskType | null, classTitle: string | null): string {
  const typeLabel = taskType ? TASK_TYPE_LABEL[taskType] : null;
  return `${typeLabel ?? "—"} · ${classTitle ?? "—"}`;
}

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

  const [{ data: taskRows }, { data: eventRows }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, due_date, due_time, completed, completed_at, created_at, task_type, class_event_id")
      .eq("user_id", userId)
      .eq("domain", "school")
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("schedule_events")
      .select(
        "id, title, is_recurring, day_of_week, event_time, end_time, location, instructor, event_date, class_group_id"
      )
      .eq("user_id", userId)
      .eq("domain", "school"),
  ]);

  const cancelledDates = await getCancelledDatesByEvent(
    supabase,
    userId,
    (eventRows ?? []).map((e) => e.id)
  );

  const allTasks = taskRows ?? [];
  const openTasks: TaskData[] = allTasks
    .filter((t) => !t.completed)
    .map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.due_date,
      dueTime: t.due_time,
      completed: t.completed,
      createdAt: t.created_at,
      taskType: t.task_type as TaskType | null,
      classEventId: t.class_event_id,
    }));
  const deadlineTasks = openTasks
    .filter((t): t is TaskData & { dueDate: string } => t.dueDate !== null)
    .map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, dueTime: t.dueTime }));

  // Today's completed tasks for the task list's Completed section — bounds
  // are the LOCAL day resolved through the profile's timezone, not a naive
  // UTC string range (AGENTS.md — this exact class of bug shipped
  // repeatedly; see resolveLocalTime's own callers in get-day-shape.ts).
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

  // Title lookup for a task's linked class, and per-class-group data for
  // the Edit popup / the add-task form's Class picker — one pass over the
  // same eventRows.
  const eventTitleById = new Map((eventRows ?? []).map((e) => [e.id, e.title]));

  type ClassGroupBuild = ClassGroup & { days: ClassGroup["days"] };
  const classGroupMap = new Map<string, ClassGroupBuild>();
  for (const e of eventRows ?? []) {
    if (!e.is_recurring || e.day_of_week === null) continue;
    const groupKey = e.class_group_id ?? e.id;
    const dateForDay = weekDates[e.day_of_week];
    const day = {
      dayOfWeek: e.day_of_week,
      eventId: e.id,
      date: dateForDay,
      cancelledThisWeek: isOccurrenceCancelled(cancelledDates, e.id, dateForDay),
    };
    const existing = classGroupMap.get(groupKey);
    if (existing) {
      existing.days.push(day);
    } else {
      classGroupMap.set(groupKey, {
        groupKey,
        title: e.title,
        eventTime: e.event_time,
        endTime: e.end_time,
        location: e.location,
        instructor: e.instructor,
        days: [day],
      });
    }
  }
  const classGroups: ClassGroup[] = Array.from(classGroupMap.values()).map((g) => ({
    ...g,
    days: [...g.days].sort((a, b) => a.dayOfWeek - b.dayOfWeek),
  }));
  const classOptions = classGroups.map((g) => ({ id: g.days[0].eventId, title: g.title }));

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

  function classTitleFor(t: TaskData): string | null {
    return t.classEventId ? (eventTitleById.get(t.classEventId) ?? null) : null;
  }
  function toKpiItem(t: TaskData): TaskRowItem {
    return {
      id: t.id,
      title: t.title,
      domain: "school",
      mode: "toggle",
      meta: formatTaskMeta(t.taskType, classTitleFor(t)),
    };
  }
  const byCreatedAtAsc = (a: TaskData, b: TaskData) => (a.createdAt < b.createdAt ? -1 : 1);

  const dueTodayItems = openTasks.filter((t) => t.dueDate === dateStr).sort(byCreatedAtAsc).map(toKpiItem);
  const overdueItems = openTasks
    .filter((t) => t.dueDate !== null && t.dueDate < dateStr)
    .sort(byCreatedAtAsc)
    .map(toKpiItem);
  const dueThisWeekItems = openTasks
    .filter((t) => t.dueDate !== null && weekDates.includes(t.dueDate))
    .sort(byCreatedAtAsc)
    .map(toKpiItem);

  const dueTodayCount = dueTodayItems.length;
  const overdueCount = overdueItems.length;
  const dueThisWeekCount = dueThisWeekItems.length;
  const scheduledThisWeekCount = countScheduledThisWeek(
    classScheduleEvents.map((e) => ({ id: e.id, isRecurring: true, dayOfWeek: e.dayOfWeek, eventDate: null })),
    weekDates,
    cancelledDates
  );

  // Completed tasks, grouped by the LOCAL week their completion fell in
  // (never a raw UTC week — AGENTS.md) — most recent week first, each
  // week's own items in completion order.
  const completedForGrouping = allTasks
    .filter((t): t is typeof t & { completed_at: string } => t.completed && t.completed_at !== null)
    .map((t) => ({
      id: t.id,
      title: t.title,
      meta: formatTaskMeta(
        t.task_type as TaskType | null,
        t.class_event_id ? (eventTitleById.get(t.class_event_id) ?? null) : null
      ),
      completedAt: t.completed_at,
    }));
  const completedWeekGroups: CompletedWeekGroup[] = groupCompletedTasksByWeek(completedForGrouping, timezone);

  return (
    <PageContainer>
      <PageHeader title="School" />

      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-4">
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
            size="sm"
          >
            <KpiTaskDialog title="Due today" items={dueTodayItems} toggleTask={toggleTask} emptyMessage="Nothing due today" />
          </KpiCard>
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={overdueCount === 0 ? ShieldCheck : AlertTriangle}
            accent={overdueCount === 0 ? "business" : "warning"}
            label="Overdue"
            value={`${overdueCount}`}
            caption={overdueCount === 0 ? "Nothing overdue" : "Needs attention"}
            size="sm"
          >
            <KpiTaskDialog title="Overdue" items={overdueItems} toggleTask={toggleTask} emptyMessage="Nothing overdue" />
          </KpiCard>
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={CalendarCheck}
            accent="school"
            label="Due this week"
            value={`${dueThisWeekCount}`}
            caption={dueThisWeekCount === 0 ? "Nothing due this week" : `${dueThisWeekCount} task${dueThisWeekCount === 1 ? "" : "s"} due`}
            size="sm"
          >
            <KpiTaskDialog
              title="Due this week"
              items={dueThisWeekItems}
              toggleTask={toggleTask}
              emptyMessage="Nothing due this week"
            />
          </KpiCard>
        </div>
        <div className="flex w-[78vw] shrink-0 snap-start items-center justify-center rounded-2xl border border-border/40 p-3 md:w-auto">
          <CompletedTasksDialog groups={completedWeekGroups} />
        </div>
      </div>

      <Panel title="Deadlines" heroValue={`${dueThisWeekCount}`} caption="due this week">
        <DeadlineList tasks={deadlineTasks} todayStr={dateStr} toggleTask={toggleTask} />
      </Panel>

      <Panel
        title="This week's classes"
        heroValue={`${scheduledThisWeekCount}`}
        caption={scheduledThisWeekCount === 0 ? "Nothing scheduled this week" : "classes this week"}
        controls={
          <ClassEditorDialog
            classes={classGroups}
            addClassEvent={addClassEvent}
            updateClassEvent={updateClassEvent}
            removeClassEvent={removeClassEvent}
            cancelScheduleOccurrence={cancelScheduleOccurrence}
            uncancelScheduleOccurrence={uncancelScheduleOccurrence}
          />
        }
      >
        <ClassScheduleWeek events={classScheduleEvents} weekDates={weekDates} todayStr={dateStr} />
      </Panel>

      <Panel id="tasks" className="scroll-mt-20" title="Task list" heroValue={`${openTasks.length}`} caption="open">
        <SchoolTaskPanel items={taskRowItems} classOptions={classOptions} addTask={addTask} toggleTask={toggleTask} removeTask={removeTask} />
      </Panel>
    </PageContainer>
  );
}
