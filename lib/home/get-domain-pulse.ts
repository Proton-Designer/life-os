import { createClient } from "@/lib/supabase/server";
import { dayOfWeekFromDateString } from "@/lib/date-utils";

export type PulseDataSource = {
  getPrayers: (userId: string, date: string) => Promise<{ prayer_name: string; status: string }[]>;
  getKillListItems: (userId: string, date: string) => Promise<{ completed: boolean }[]>;
  getTasks: (
    userId: string,
    date: string
  ) => Promise<{ domain: "school" | "co_op"; completed: boolean }[]>;
  getHabits: (
    userId: string,
    date: string
  ) => Promise<{ habitId: string; completed: boolean }[]>;
  getWorkoutSchedule: (
    userId: string,
    dayOfWeek: number
  ) => Promise<{ day_of_week: number; workout_name: string } | null>;
  getWorkoutLogs: (userId: string, date: string) => Promise<{ workout_name: string }[]>;
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
    async getTasks(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("tasks")
        .select("domain, completed")
        .eq("user_id", userId)
        .eq("due_date", date);
      return (data ?? []) as { domain: "school" | "co_op"; completed: boolean }[];
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
        .select("day_of_week, workout_name")
        .eq("user_id", userId)
        .eq("day_of_week", dayOfWeek)
        .maybeSingle();
      return data ?? null;
    },
    async getWorkoutLogs(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("workout_logs")
        .select("workout_name")
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
  const [prayers, killList, tasks, habits, workoutSchedule, workoutLogs] = await Promise.all([
    dataSource.getPrayers(userId, date),
    dataSource.getKillListItems(userId, date),
    dataSource.getTasks(userId, date),
    dataSource.getHabits(userId, date),
    dataSource.getWorkoutSchedule(userId, dayOfWeek),
    dataSource.getWorkoutLogs(userId, date),
  ]);

  const prayersDone = prayers.filter((p) => p.status !== "pending" && p.status !== "missed").length;
  const deen = safeFraction(prayersDone, 5);

  const business = safeFraction(
    killList.filter((k) => k.completed).length,
    killList.length
  );

  const hasScheduledWorkout = workoutSchedule !== null;
  const workoutDone = hasScheduledWorkout
    ? workoutLogs.some((w) => w.workout_name === workoutSchedule.workout_name)
    : false;
  const habitsDone = habits.filter((h) => h.completed).length;
  const fitness = safeFraction(
    habitsDone + (workoutDone ? 1 : 0),
    habits.length + (hasScheduledWorkout ? 1 : 0)
  );

  const schoolTasks = tasks.filter((t) => t.domain === "school");
  const coOpTasks = tasks.filter((t) => t.domain === "co_op");
  const school = safeFraction(
    schoolTasks.filter((t) => t.completed).length,
    schoolTasks.length
  );
  const co_op = safeFraction(
    coOpTasks.filter((t) => t.completed).length,
    coOpTasks.length
  );

  return { deen, business, fitness, school, co_op };
}
