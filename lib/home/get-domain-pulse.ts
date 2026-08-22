import { createClient } from "@/lib/supabase/server";
import { dayOfWeekFromDateString } from "@/lib/date-utils";

export type PulseDataSource = {
  getPrayers: (userId: string, date: string) => Promise<{ prayer_name: string; status: string }[]>;
  getKillListItems: (userId: string, date: string) => Promise<{ completed: boolean }[]>;
  /** School only now — Work moved off the shared `tasks` table entirely (coop_targets/coop_tasks) and gets its own pipeline-driven source below. */
  getSchoolTasks: (userId: string, date: string) => Promise<{ completed: boolean }[]>;
  /**
   * Work's pulse used to come from the same due-date `tasks` query as
   * School, which stopped matching Work's real model the moment it moved
   * to Targets/Agenda/Pipeline (docs/superpowers/specs/2026-08-20-coop-redesign.md)
   * — a due-date-shaped question asked of a pipeline-shaped domain, same
   * class of drift as this file's own workout_id repoint comment.
   * Completion of the CURRENT target's (position 1) tasks is what "Work
   * progress" now actually means; with no current target, or a target
   * with zero tasks, this returns [] and safeFraction below correctly
   * reads that as null — nothing tracked, not zero progress.
   */
  getCurrentCoopTargetTaskCompletion: (userId: string) => Promise<{ completed: boolean }[]>;
  getHabits: (
    userId: string,
    date: string
  ) => Promise<{ habitId: string; completed: boolean }[]>;
  getWorkoutSchedule: (
    userId: string,
    dayOfWeek: number
  ) => Promise<{ day_of_week: number; workout_id: string | null } | null>;
  getWorkoutSessions: (userId: string, date: string) => Promise<{ workout_id: string | null }[]>;
};

export type DomainPulse = {
  deen: number | null;
  business: number | null;
  fitness: number | null;
  school: number | null;
  co_op: number | null;
};

// Nothing tracked ≠ zero progress: a 0% ring on a day with nothing
// scheduled is a wrong number, not a low one.
function safeFraction(done: number, total: number): number | null {
  return total === 0 ? null : done / total;
}

function defaultDataSource(): PulseDataSource {
  return {
    async getPrayers(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("prayers")
        .select("prayer_name, status")
        .eq("user_id", userId)
        .eq("date", date);
      return data ?? [];
    },
    async getKillListItems(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("kill_list_items")
        .select("completed")
        .eq("user_id", userId)
        .eq("date", date);
      return data ?? [];
    },
    async getSchoolTasks(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("tasks")
        .select("completed")
        .eq("user_id", userId)
        .eq("domain", "school")
        .eq("due_date", date);
      return data ?? [];
    },
    async getCurrentCoopTargetTaskCompletion(userId) {
      const supabase = await createClient();
      const { data: currentTarget } = await supabase
        .from("coop_targets")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "active")
        .eq("position", 1)
        .maybeSingle();
      if (!currentTarget) return [];
      const { data: tasks } = await supabase
        .from("coop_tasks")
        .select("status")
        .eq("user_id", userId)
        .eq("target_id", currentTarget.id);
      return (tasks ?? []).map((t) => ({ completed: t.status === "complete" }));
    },
    async getHabits(userId, date) {
      const supabase = await createClient();
      const { data: habits } = await supabase
        .from("custom_habits")
        .select("id")
        .eq("user_id", userId)
        .eq("domain", "fitness")
        .eq("archived", false);
      const { data: logs } = await supabase
        .from("habit_logs")
        .select("habit_id, completed")
        .eq("user_id", userId)
        .eq("date", date);
      return (habits ?? []).map((h) => ({
        habitId: h.id,
        completed: logs?.some((l) => l.habit_id === h.id && l.completed) ?? false,
      }));
    },
    async getWorkoutSchedule(userId, dayOfWeek) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("workout_schedule")
        .select("day_of_week, workout_id")
        .eq("user_id", userId)
        .eq("day_of_week", dayOfWeek)
        .maybeSingle();
      return data ?? null;
    },
    async getWorkoutSessions(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("workout_sessions")
        .select("workout_id")
        .eq("user_id", userId)
        .eq("date", date);
      return data ?? [];
    },
  };
}

export async function getDomainPulse(
  userId: string,
  date: string,
  dataSource: PulseDataSource = defaultDataSource()
): Promise<DomainPulse> {
  const dayOfWeek = dayOfWeekFromDateString(date);
  const [prayers, killList, schoolTasks, coopTaskCompletion, habits, workoutSchedule, workoutSessions] = await Promise.all([
    dataSource.getPrayers(userId, date),
    dataSource.getKillListItems(userId, date),
    dataSource.getSchoolTasks(userId, date),
    dataSource.getCurrentCoopTargetTaskCompletion(userId),
    dataSource.getHabits(userId, date),
    dataSource.getWorkoutSchedule(userId, dayOfWeek),
    dataSource.getWorkoutSessions(userId, date),
  ]);

  const prayersDone = prayers.filter((p) => p.status !== "pending" && p.status !== "missed").length;
  const deen = safeFraction(prayersDone, 5);

  const business = safeFraction(
    killList.filter((k) => k.completed).length,
    killList.length
  );

  // Matched by workout_id, not name — see get-domain-snapshots.ts's
  // identical comment on the same repoint.
  const hasScheduledWorkout = workoutSchedule?.workout_id != null;
  const workoutDone = hasScheduledWorkout
    ? workoutSessions.some((w) => w.workout_id === workoutSchedule.workout_id)
    : false;
  const habitsDone = habits.filter((h) => h.completed).length;
  const fitness = safeFraction(
    habitsDone + (workoutDone ? 1 : 0),
    habits.length + (hasScheduledWorkout ? 1 : 0)
  );

  const school = safeFraction(
    schoolTasks.filter((t) => t.completed).length,
    schoolTasks.length
  );
  const co_op = safeFraction(
    coopTaskCompletion.filter((t) => t.completed).length,
    coopTaskCompletion.length
  );

  return { deen, business, fitness, school, co_op };
}
