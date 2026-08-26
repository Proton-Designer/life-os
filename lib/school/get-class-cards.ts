import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { weekDatesFrom } from "@/lib/date-utils";

export type ClassCardData = {
  id: string;
  /** Ayman's own abbreviation, hand-seeded per class — falls back to `code`
   * everywhere it's displayed. A class added later (or before the Lead's
   * hand-seed lands) has this null; that is the normal, expected shape,
   * not an error state. */
  shortName: string | null;
  code: string;
  room: string | null;
  instructor: string | null;
  hasSyllabus: boolean;
  tasksDueThisWeek: number;
  upcomingAssessment: { name: string; date: string } | null;
  /** All of this class's assessments, date ascending — carried alongside
   * `upcomingAssessment` (still derived from this same array, not a
   * separate query) so the expanded class view can render its full list
   * without a second round-trip once it opens (item A2). */
  assessments: { id: string; name: string; type: string; date: string; taskId: string | null }[];
  /** This class's incomplete tasks, regardless of week — deliberately
   * wider than `tasksDueThisWeek`'s this-week/incomplete filter, since the
   * expanded class view's task list isn't scoped to the week the way the
   * card's own count is. */
  tasks: {
    id: string;
    title: string;
    dueDate: string | null;
    taskType: string | null;
    taskTypeOtherLabel: string | null;
    classId: string | null;
  }[];
};

/**
 * Shapes the School screen's classes grid (item 6b) from three tables —
 * classes, tasks (filtered by class_id and this week's due_date, B's 050),
 * and class_assessments (nearest date >= today) — into one render-ready
 * array per class. Pure data shaping, no rendering: components/school/
 * class-card.tsx takes the result as a prop, same split as
 * WeekCalendarView/HabitBuilder elsewhere in this app.
 *
 * Lin Alg (MATH 2418, item 6 spec) is the real null-path case this
 * function must get right generally, not as a special case: zero linked
 * schedule_events, null room/instructor, zero tasks, zero assessments —
 * every class added through a future editor before its details are filled
 * in will hit this identical shape.
 */
export async function getClassCards(
  supabase: SupabaseClient<Database>,
  userId: string,
  weekStart: string,
  todayStr: string
): Promise<ClassCardData[]> {
  const weekDates = weekDatesFrom(weekStart);
  const weekEnd = weekDates[weekDates.length - 1];

  const { data: classRows, error: classError } = await supabase
    .from("classes")
    .select("id, short_name, code, room, instructor, syllabus_path")
    .eq("user_id", userId)
    .order("position", { ascending: true, nullsFirst: false })
    .order("code", { ascending: true });
  if (classError) throw classError;
  const classes = classRows ?? [];
  if (classes.length === 0) return [];

  const classIds = classes.map((c) => c.id);

  // Widened from "this week, incomplete" to "all incomplete" so the
  // expanded class view (opened via ClassCard's View button) can render
  // its full task list from THIS same query — no second round-trip once
  // the dialog opens (item A2, kills the open-then-load waterfall).
  // `tasksDueThisWeek` and `upcomingAssessment` stay derived in-memory
  // from these same rows, not separate narrower queries.
  const [{ data: taskRows, error: taskError }, { data: assessmentRows, error: assessmentError }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, due_date, task_type, task_type_other_label, class_id")
      .eq("user_id", userId)
      .eq("completed", false)
      .in("class_id", classIds),
    supabase
      .from("class_assessments")
      .select("id, class_id, name, type, date, task_id")
      .eq("user_id", userId)
      .in("class_id", classIds)
      .order("date", { ascending: true }),
  ]);
  if (taskError) throw taskError;
  if (assessmentError) throw assessmentError;

  const tasksByClass = new Map<string, ClassCardData["tasks"]>();
  for (const t of taskRows ?? []) {
    if (!t.class_id) continue;
    const list = tasksByClass.get(t.class_id) ?? [];
    list.push({
      id: t.id,
      title: t.title,
      dueDate: t.due_date,
      taskType: t.task_type,
      taskTypeOtherLabel: t.task_type_other_label,
      classId: t.class_id,
    });
    tasksByClass.set(t.class_id, list);
  }

  const assessmentsByClass = new Map<string, ClassCardData["assessments"]>();
  for (const a of assessmentRows ?? []) {
    const list = assessmentsByClass.get(a.class_id) ?? [];
    list.push({ id: a.id, name: a.name, type: a.type, date: a.date, taskId: a.task_id });
    assessmentsByClass.set(a.class_id, list);
  }

  return classes.map((c) => {
    const tasks = tasksByClass.get(c.id) ?? [];
    const assessments = assessmentsByClass.get(c.id) ?? [];
    // Rows are already ordered by date ascending, so the first future
    // assessment is the nearest upcoming one — no separate min() pass.
    const upcomingAssessment = assessments.find((a) => a.date >= todayStr) ?? null;
    return {
      id: c.id,
      shortName: c.short_name,
      code: c.code,
      room: c.room,
      instructor: c.instructor,
      hasSyllabus: c.syllabus_path !== null,
      tasksDueThisWeek: tasks.filter((t) => t.dueDate !== null && t.dueDate >= weekStart && t.dueDate <= weekEnd).length,
      upcomingAssessment: upcomingAssessment ? { name: upcomingAssessment.name, date: upcomingAssessment.date } : null,
      assessments,
      tasks,
    };
  });
}
