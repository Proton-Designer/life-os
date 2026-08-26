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
    .order("code", { ascending: true });
  if (classError) throw classError;
  const classes = classRows ?? [];
  if (classes.length === 0) return [];

  const classIds = classes.map((c) => c.id);

  const [{ data: taskRows, error: taskError }, { data: assessmentRows, error: assessmentError }] = await Promise.all([
    supabase
      .from("tasks")
      .select("class_id")
      .eq("user_id", userId)
      .eq("completed", false)
      .in("class_id", classIds)
      .gte("due_date", weekStart)
      .lte("due_date", weekEnd),
    supabase
      .from("class_assessments")
      .select("class_id, name, date")
      .eq("user_id", userId)
      .in("class_id", classIds)
      .gte("date", todayStr)
      .order("date", { ascending: true }),
  ]);
  if (taskError) throw taskError;
  if (assessmentError) throw assessmentError;

  const taskCountByClass = new Map<string, number>();
  for (const t of taskRows ?? []) {
    if (!t.class_id) continue;
    taskCountByClass.set(t.class_id, (taskCountByClass.get(t.class_id) ?? 0) + 1);
  }

  // Rows are already ordered by date ascending, so the FIRST match per
  // class is its nearest upcoming assessment — no separate min() pass.
  const upcomingByClass = new Map<string, { name: string; date: string }>();
  for (const a of assessmentRows ?? []) {
    if (!upcomingByClass.has(a.class_id)) {
      upcomingByClass.set(a.class_id, { name: a.name, date: a.date });
    }
  }

  return classes.map((c) => ({
    id: c.id,
    shortName: c.short_name,
    code: c.code,
    room: c.room,
    instructor: c.instructor,
    hasSyllabus: c.syllabus_path !== null,
    tasksDueThisWeek: taskCountByClass.get(c.id) ?? 0,
    upcomingAssessment: upcomingByClass.get(c.id) ?? null,
  }));
}
