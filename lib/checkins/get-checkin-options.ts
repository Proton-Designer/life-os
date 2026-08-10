import { createClient } from "@/lib/supabase/server";
import { localDateString, dayOfWeekFromDateString, resolveLocalTime } from "@/lib/date-utils";
import type { CheckinOption } from "./types";

const RIGHT_NOW_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours, same window as Home's urgency bucketing

export type CheckinDataSource = {
  getProfile: (userId: string) => Promise<{ timezone: string } | null>;
  getKillListItems: (userId: string, date: string) => Promise<{ id: string; text: string; completed: boolean }[]>;
  getWorkoutSchedule: (
    userId: string,
    dayOfWeek: number
  ) => Promise<{ workout_name: string; time: string | null } | null>;
};

function defaultDataSource(): CheckinDataSource {
  return {
    async getProfile(userId) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("user_id", userId)
        .maybeSingle();
      return data ?? null;
    },
    async getKillListItems(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("kill_list_items")
        .select("id, text, completed")
        .eq("user_id", userId)
        .eq("date", date)
        .order("position", { ascending: true });
      return data ?? [];
    },
    async getWorkoutSchedule(userId, dayOfWeek) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("workout_schedule")
        .select("workout_name, time")
        .eq("user_id", userId)
        .eq("day_of_week", dayOfWeek)
        .maybeSingle();
      return data ?? null;
    },
  };
}

export async function getCheckinOptions(
  userId: string,
  now: Date,
  dataSource: CheckinDataSource = defaultDataSource()
): Promise<CheckinOption[]> {
  const profile = await dataSource.getProfile(userId);
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);

  const [killListItems, workoutSchedule] = await Promise.all([
    dataSource.getKillListItems(userId, dateStr),
    dataSource.getWorkoutSchedule(userId, dayOfWeekFromDateString(dateStr)),
  ]);

  const options: CheckinOption[] = [];

  // Workout scheduled in the current window comes first, per spec.
  if (workoutSchedule) {
    const inWindow =
      !workoutSchedule.time ||
      Math.abs(resolveLocalTime(dateStr, workoutSchedule.time, timezone).getTime() - now.getTime()) <=
        RIGHT_NOW_WINDOW_MS;
    if (inWindow) {
      options.push({
        tagType: "workout",
        refId: null,
        label: workoutSchedule.workout_name,
        primary: true,
      });
    }
  }

  // Every currently-set kill-list item, as its own option (per spec — this
  // is distinct from Home's rolled-up single-item display).
  for (const item of killListItems) {
    options.push({ tagType: "kill_list", refId: item.id, label: item.text, primary: true });
  }

  options.push({ tagType: "deen", refId: null, label: "Deen", primary: true });
  options.push({ tagType: "other_work", refId: null, label: "Other work", primary: true });
  options.push({ tagType: "noise", refId: null, label: "Noise / distraction", primary: true });

  // Less-central domains live under "Something else," per spec.
  options.push({ tagType: "school", refId: null, label: "School", primary: false });
  options.push({ tagType: "co_op", refId: null, label: "Co-op", primary: false });

  return options;
}
