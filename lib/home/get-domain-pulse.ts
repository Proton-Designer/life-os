import { createClient } from "@/lib/supabase/server";

export type PulseDataSource = {
  getPrayers: (userId: string, date: string) => Promise<{ prayer_name: string; status: string }[]>;
  getAdhkarLogs: (userId: string, date: string) => Promise<{ period: string; completed: boolean }[]>;
  getKillListItems: (userId: string, date: string) => Promise<{ completed: boolean }[]>;
  getTasks: (
    userId: string,
    date: string
  ) => Promise<{ domain: "school" | "co_op"; completed: boolean }[]>;
  getHabits: (
    userId: string,
    date: string
  ) => Promise<{ habitId: string; completed: boolean }[]>;
};

export type DomainPulse = {
  deen: number;
  business: number;
  fitness: number;
  school: number;
};

function safeFraction(done: number, total: number): number {
  return total === 0 ? 0 : done / total;
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
    async getAdhkarLogs(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("adhkar_logs")
        .select("period, completed")
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
  };
}

export async function getDomainPulse(
  userId: string,
  date: string,
  dataSource: PulseDataSource = defaultDataSource()
): Promise<DomainPulse> {
  const [prayers, adhkar, killList, tasks, habits] = await Promise.all([
    dataSource.getPrayers(userId, date),
    dataSource.getAdhkarLogs(userId, date),
    dataSource.getKillListItems(userId, date),
    dataSource.getTasks(userId, date),
    dataSource.getHabits(userId, date),
  ]);

  const prayersDone = prayers.filter((p) => p.status !== "pending" && p.status !== "missed").length;
  const adhkarDone = adhkar.filter((a) => a.completed).length;
  const deen = safeFraction(prayersDone + adhkarDone, 5 + 2);

  const business = safeFraction(
    killList.filter((k) => k.completed).length,
    killList.length
  );

  const fitness = safeFraction(habits.filter((h) => h.completed).length, habits.length);

  const school = safeFraction(
    tasks.filter((t) => t.completed).length,
    tasks.length
  );

  return { deen, business, fitness, school };
}
