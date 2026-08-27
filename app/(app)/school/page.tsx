import { redirect } from "next/navigation";
import { CalendarClock, AlertTriangle, ShieldCheck, CalendarCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, weekDatesFrom, formatShortDate } from "@/lib/date-utils";
import { countScheduledThisWeek } from "@/lib/tasks/schedule-metrics";
import { getCancelledDatesByEvent, isOccurrenceCancelled } from "@/lib/tasks/schedule-cancellations";
import { TASK_TYPE_LABEL, type TaskType } from "@/lib/tasks/task-type";
import { groupCompletedTasksByWeek } from "@/lib/tasks/completed-by-week";
import {
  addTask,
  updateTask,
  toggleTask,
  removeTask,
  addClassEvent,
  updateClassEvent,
  removeClassEvent,
  cancelScheduleOccurrence,
  uncancelScheduleOccurrence,
} from "./actions";
import { createClass } from "./class-actions";
import type { TaskRowItem } from "@/components/shared/task-row-list";
import { ClassScheduleWeek, type ClassScheduleEvent } from "@/components/school/class-schedule-week";
import { ClassEditorDialog, type ClassGroup } from "@/components/school/class-editor-dialog";
import { AddClassDialog } from "@/components/school/add-class-dialog";
import { KpiTaskDialog } from "@/components/school/kpi-task-dialog";
import { CompletedTasksDialog, type CompletedWeekGroup } from "@/components/school/completed-tasks-dialog";
import { TaskListModule, type TaskListItem } from "@/components/school/task-list-module";
import { TaskWizardDialog, type TaskWizardClassOption } from "@/components/school/task-wizard-dialog";
import { TaskEditDialog } from "@/components/school/task-edit-dialog";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Panel } from "@/components/ui/panel";
import { getClassCards } from "@/lib/school/get-class-cards";
import { ClassCard } from "@/components/school/class-card";

type TaskData = {
  id: string;
  title: string;
  dueDate: string | null;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
  taskType: TaskType | null;
  taskTypeOtherLabel: string | null;
  classId: string | null;
};

function formatKpiMeta(taskType: TaskType | null, taskTypeOtherLabel: string | null, className: string | null): string {
  const typeLabel = taskType ? (taskType === "other" && taskTypeOtherLabel ? taskTypeOtherLabel : TASK_TYPE_LABEL[taskType]) : null;
  return `${typeLabel ?? "—"} · ${className ?? "—"}`;
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

  const [{ data: taskRows }, { data: eventRows }, { data: classRows }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, due_date, completed, completed_at, created_at, task_type, task_type_other_label, class_id")
      .eq("user_id", userId)
      .eq("domain", "school"),
    supabase
      .from("schedule_events")
      .select(
        "id, title, is_recurring, day_of_week, event_time, end_time, location, instructor, event_date, class_group_id"
      )
      .eq("user_id", userId)
      .eq("domain", "school"),
    supabase.from("classes").select("id, short_name, code").eq("user_id", userId),
  ]);

  const cancelledDates = await getCancelledDatesByEvent(
    supabase,
    userId,
    (eventRows ?? []).map((e) => e.id)
  );

  const classNameById = new Map((classRows ?? []).map((c) => [c.id, c.short_name ?? c.code]));
  const classOptions: TaskWizardClassOption[] = (classRows ?? []).map((c) => ({
    id: c.id,
    label: c.short_name ?? c.code,
  }));

  const allTasks: TaskData[] = (taskRows ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: t.due_date,
    completed: t.completed,
    completedAt: t.completed_at,
    createdAt: t.created_at,
    taskType: t.task_type as TaskType | null,
    taskTypeOtherLabel: t.task_type_other_label,
    classId: t.class_id,
  }));
  const openTasks = allTasks.filter((t) => !t.completed);

  // The unified Task list (item 5, 2026-08-26 night batch 2) — every open
  // task carries a real taskType by now (the wizard requires one), so the
  // `?? "other"` fallback only ever covers a hand-inserted or pre-migration
  // row that predates the wizard.
  const taskListItems: TaskListItem[] = openTasks.map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: t.dueDate,
    taskType: t.taskType ?? "other",
    taskTypeOtherLabel: t.taskTypeOtherLabel,
    classId: t.classId,
    className: t.classId ? (classNameById.get(t.classId) ?? null) : null,
  }));

  // Title lookup for schedule_events + per-class-group data for the
  // "This week's classes" Edit popup — one pass over eventRows. Distinct
  // from the `classes` entity above: this is the recurring-meeting-time
  // editor (pre-existing feature), not item 6's class entity.
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

  function toKpiItem(t: TaskData): TaskRowItem {
    return {
      id: t.id,
      title: t.title,
      domain: "school",
      mode: "toggle",
      // Two-line row: the meta now carries date · type · class, which cannot
      // share a line with a real title on a phone (Ayman, 2026-08-27).
      metaBelow: true,
      // Due date leads the meta (Ayman, 2026-08-27: "add the due dates for
      // each task as part of the row as well"). First segment, not last,
      // because in the Overdue bucket it's the whole point of the row —
      // "how late is this" beats "what type is it". Formatted through the
      // shared formatShortDate so it reads "Aug. 28th" like every other
      // date on this screen, never a raw ISO string. Undated tasks simply
      // omit the segment rather than printing a placeholder; they can only
      // reach the Due today bucket via a null dueDate, which the filters
      // already exclude, so in practice this is defensive.
      meta: [
        t.dueDate ? formatShortDate(t.dueDate, dateStr) : null,
        formatKpiMeta(t.taskType, t.taskTypeOtherLabel, t.classId ? (classNameById.get(t.classId) ?? null) : null),
      ]
        .filter(Boolean)
        .join(" · "),
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
    .filter((t): t is TaskData & { completedAt: string } => t.completed && t.completedAt !== null)
    .map((t) => ({
      id: t.id,
      title: t.title,
      meta: formatKpiMeta(t.taskType, t.taskTypeOtherLabel, t.classId ? (classNameById.get(t.classId) ?? null) : null),
      completedAt: t.completedAt,
    }));
  const completedWeekGroups: CompletedWeekGroup[] = groupCompletedTasksByWeek(completedForGrouping, timezone);

  const classCards = await getClassCards(supabase, userId, weekStart, dateStr);

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
          <CompletedTasksDialog groups={completedWeekGroups} removeTask={removeTask} />
        </div>
      </div>

      {/* Item 6b (Ayman, verbatim): "a module card for every single class
          im taking," below the top mini modules. Cards are visibly
          non-uniform by design — Lin Alg (MATH 2418) has no room/instructor/
          syllabus/tasks/assessment yet, so `items-start` keeps a short card
          short instead of CSS Grid stretching it to match its row. */}
      {classCards.length > 0 && (
        <div data-testid="class-cards-grid" className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classCards.map((c) => (
            <ClassCard key={c.id} data={c} timezone={timezone} todayStr={dateStr} />
          ))}
        </div>
      )}

      <Panel
        id="tasks"
        className="scroll-mt-20"
        title="Task list"
        // This week's open tasks, not every open task ever (Ayman,
        // 2026-08-27). Reuses dueThisWeekCount rather than recomputing, so
        // this and the "Due this week" KPI can never disagree. Undated and
        // previous-week-overdue tasks fall outside it by design — overdue has
        // its own KPI — and the caption carries that scope, since a bare
        // number under "Task list" would otherwise read as the total.
        heroValue={`${dueThisWeekCount}`}
        caption="due this week"
        controls={
          <div className="flex gap-2">
            <TaskWizardDialog classes={classOptions} timezone={timezone} onSubmit={addTask} />
            <TaskEditDialog tasks={taskListItems} classes={classOptions} todayStr={dateStr} updateTask={updateTask} removeTask={removeTask} />
          </div>
        }
      >
        <TaskListModule tasks={taskListItems} classes={classOptions} todayStr={dateStr} weekDates={weekDates} toggleTask={toggleTask} />
      </Panel>

      <Panel
        title="This week's classes"
        heroValue={`${scheduledThisWeekCount}`}
        caption={scheduledThisWeekCount === 0 ? "Nothing scheduled this week" : "classes this week"}
        controls={
          <div className="flex gap-2">
            <AddClassDialog createClass={createClass} addClassEvent={addClassEvent} />
            <ClassEditorDialog
              classes={classGroups}
              addClassEvent={addClassEvent}
              updateClassEvent={updateClassEvent}
              removeClassEvent={removeClassEvent}
              cancelScheduleOccurrence={cancelScheduleOccurrence}
              uncancelScheduleOccurrence={uncancelScheduleOccurrence}
            />
          </div>
        }
      >
        <ClassScheduleWeek events={classScheduleEvents} weekDates={weekDates} todayStr={dateStr} />
      </Panel>
    </PageContainer>
  );
}
