import { redirect } from "next/navigation";
import { CalendarClock, AlertTriangle, ShieldCheck, CalendarCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, weekDatesFrom, formatShortDate } from "@/lib/date-utils";
import { deadlineWindow } from "@/lib/tasks/task-groups";
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
import { getTranscriptionAvailability } from "./transcript-actions";
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
import { DeadlineRiskPanel, type DeadlineRiskRow } from "@/components/school/deadline-risk-panel";
import { CourseLoadForecastPanel } from "@/components/school/course-load-forecast-panel";
import { computeCourseLoadForecast, type ForecastableAssessment } from "@/lib/school/course-load-forecast";
import { SchoolTodayPanel } from "@/components/school/school-today-panel";
import { getSchoolTodayFeed } from "@/lib/school/school-today";

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

  // getClassCards/getSchoolTodayFeed depend only on userId/weekStart/dateStr (known
  // before any of the three queries below resolve), so both join this wave instead of
  // waiting behind them — 3 waves down to 2 for this page (2026-08-28 audit).
  const [{ data: taskRows }, { data: eventRows }, { data: classRows }, classCards, schoolTodayItems, transcriptionAvailability] = await Promise.all([
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
    getClassCards(supabase, userId, weekStart, dateStr),
    // Phase 1 #15 — /school wants TODAY specifically, so both date params are dateStr
    // here; #28 (Night Plan, an evening ritual planning tomorrow) will pass a different
    // targetDate than todayStr when it becomes this function's second caller.
    getSchoolTodayFeed(supabase, userId, dateStr, dateStr),
    // P3-15 — account-wide (not per-class), fetched once here and threaded down through
    // ClassCard -> ClassDetailDialog -> LecturePanel rather than re-fetched per class.
    getTranscriptionAvailability(),
  ]);

  const cancelledDates = await getCancelledDatesByEvent(
    supabase,
    userId,
    (eventRows ?? []).map((e) => e.id)
  );

  const classNameById = new Map((classRows ?? []).map((c) => [c.id, c.short_name ?? c.code]));

  // Phase 1 #14 — cross-class deadline/risk dashboard. Same deadlineWindow()
  // TaskListModule uses for bucketTaskGroup, so this panel's buckets can never drift
  // from the Task list's (lib/tasks/task-groups.ts's own vocabulary) — #51 fix
  // (2026-09-14): this is now the ONLY place either file derives nextWeekDates/
  // horizonStr, closing the exact duplication risk that let the old horizon defect
  // (weekday-dependent 17-23 day "Upcoming" window) go unnoticed.
  const { nextWeekDates, horizonStr } = deadlineWindow(weekDates);
  const deadlineRiskRows: DeadlineRiskRow[] = classCards.flatMap((c) =>
    c.assessments.map((a) => ({
      id: a.id,
      name: a.name,
      className: c.shortName ?? c.code,
      dueDate: a.date,
      risk: { score: a.risk.score, band: a.risk.band },
    }))
  );
  // Panel's own one-metric-rule convention (its header comment): the number that
  // summarizes this panel, not a separate KPI card duplicating it.
  const highRiskCount = deadlineRiskRows.filter((r) => r.risk.band === "high" || r.risk.band === "critical").length;

  // Phase 2 #P2-10 — course-load forecast. Reuses classCards' assessments
  // (the SAME data deadlineRiskRows above is built from), not a second
  // query — see lib/school/course-load-forecast.ts's own header.
  const forecastableAssessments: ForecastableAssessment[] = classCards.flatMap((c) =>
    c.assessments.map((a) => ({
      id: a.id,
      name: a.name,
      className: c.shortName ?? c.code,
      date: a.date,
      weightPct: a.weightPct,
      pointsEarned: a.pointsEarned,
      isExcused: a.isExcused,
    }))
  );
  const courseLoadForecast = computeCourseLoadForecast(forecastableAssessments, dateStr);
  const overflowWeekCount = courseLoadForecast.weeks.filter((w) => w.overflow).length;

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
  // Excludes overdue (2026-09-10, Ayman: "overdue items still remain present
  // in the task list, make sure that they are auto removed and just show in
  // the overdue section"). Before this, `weekDates.includes(t.dueDate)` alone
  // admitted days earlier THIS week that had already passed — e.g. Sunday's
  // task was still "due this week" on Tuesday — double-counting it against
  // the Overdue card immediately to the left. `t.dueDate >= dateStr` is the
  // exact logical complement of `overdueItems`'s own `dueDate < dateStr`
  // above, over the non-null dates both filters share, so a task lands in
  // exactly one of the two, never both, never neither. `bucketTaskGroup`
  // (lib/tasks/task-groups.ts) draws its own overdue line at the same
  // `dueDate < todayStr` boundary — pinned by the today/yesterday boundary
  // tests in lib/tasks/__tests__/task-groups.test.ts, so the KPI card, this
  // panel, and the Task list module's own exclusion cannot drift apart.
  const dueThisWeekItems = openTasks
    .filter((t) => t.dueDate !== null && t.dueDate >= dateStr && weekDates.includes(t.dueDate))
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

      {/* Task list sits directly under the three KPI modules and ABOVE the
          per-class cards (Ayman, 2026-09-10): the cross-class view of what
          is actually due is the reason to open this screen, and the class
          cards are the drill-down from it, not the other way round. */}
      <Panel
        id="tasks"
        className="scroll-mt-20"
        title="Task list"
        // This week's open tasks, not every open task ever (Ayman,
        // 2026-08-27). Reuses dueThisWeekCount rather than recomputing, so
        // this and the "Due this week" KPI can never disagree. Undated and
        // overdue tasks (this week's already-passed days included, since
        // 2026-09-10) fall outside it by design — overdue has its own KPI,
        // and TaskListModule auto-excludes it the same way (task-groups.ts)
        // — and the caption carries that scope, since a bare number under
        // "Task list" would otherwise read as the total.
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

      {/* Phase 1 #15 — day-level, sits above #14's wider window: "what does school look
          like today" is a narrower, more urgent question than "what's coming up." */}
      <Panel title="School today" heroValue={`${schoolTodayItems.length}`} caption="due today across your classes">
        <SchoolTodayPanel items={schoolTodayItems} />
      </Panel>

      {/* Phase 1 #14 — the cross-class risk rollup the Task list doesn't provide (it's
          date-ordered, not risk-ranked, and only ever shows tasks, not assessments).
          Sits beside the Task list rather than inside it: different unit (assessments,
          not tasks) and a different ordering principle (risk, not date). */}
      <Panel
        title="Deadline risk"
        heroValue={`${highRiskCount}`}
        caption={highRiskCount === 0 ? "nothing high-risk right now" : `high/critical-risk assessment${highRiskCount === 1 ? "" : "s"}`}
      >
        <DeadlineRiskPanel
          rows={deadlineRiskRows}
          todayStr={dateStr}
          weekDates={weekDates}
          nextWeekDates={nextWeekDates}
          horizonStr={horizonStr}
        />
      </Panel>

      {/* Phase 2 #P2-10 — course-load forecast. Sits beside Deadline risk:
          that panel ranks INDIVIDUAL items by risk within a short window;
          this one shows the SHAPE of the next six weeks so a cluster of
          assessments is visible before any one of them is individually
          "at risk." */}
      <Panel
        title="Course load"
        heroValue={`${overflowWeekCount}`}
        caption={overflowWeekCount === 0 ? "no overloaded weeks ahead" : `overloaded week${overflowWeekCount === 1 ? "" : "s"} ahead`}
      >
        <CourseLoadForecastPanel forecast={courseLoadForecast} todayStr={dateStr} />
      </Panel>

      {/* Item 6b (Ayman, verbatim): "a module card for every single class
          im taking," below the top mini modules. Cards are visibly
          non-uniform by design — Lin Alg (MATH 2418) has no room/instructor/
          syllabus/tasks/assessment yet, so `items-start` keeps a short card
          short instead of CSS Grid stretching it to match its row. */}
      {classCards.length > 0 && (
        <div data-testid="class-cards-grid" className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classCards.map((c) => (
            <ClassCard
              key={c.id}
              data={c}
              timezone={timezone}
              todayStr={dateStr}
              hasOpenAiKey={transcriptionAvailability.hasOpenAi}
              hasGoogleKey={transcriptionAvailability.hasGoogle}
            />
          ))}
        </div>
      )}

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
