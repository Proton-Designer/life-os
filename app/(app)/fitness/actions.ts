"use server";

import { requireUser } from "@/lib/supabase/auth";
import { revalidatePath } from "next/cache";

export async function addHabit(name: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("custom_habits")
    .insert({ user_id: userId, domain: "fitness", name });
  if (error) throw error;
  revalidatePath("/fitness");
}

export async function toggleHabit(habitId: string, date: string): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data: existing } = await supabase
    .from("habit_logs")
    .select("completed")
    .eq("habit_id", habitId)
    .eq("date", date)
    .maybeSingle();

  const { error } = await supabase.from("habit_logs").upsert(
    {
      habit_id: habitId,
      user_id: userId,
      date,
      completed: !existing?.completed,
    },
    { onConflict: "habit_id,date" }
  );
  if (error) throw error;
  revalidatePath("/fitness");
  revalidatePath("/");
}

/**
 * Archives (never hard-deletes) — custom_habits.archived exists for this;
 * hard-deleting would cascade-delete the habit's historical habit_logs via
 * the FK, destroying past streak/consistency data.
 */
export async function removeHabit(habitId: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("custom_habits")
    .update({ archived: true })
    .eq("id", habitId)
    .eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/fitness");
}

export async function setWorkoutSchedule(
  dayOfWeek: number,
  workoutName: string | null,
  time: string | null
): Promise<void> {
  const { supabase, userId } = await requireUser();

  if (workoutName === null) {
    const { error } = await supabase
      .from("workout_schedule")
      .delete()
      .eq("user_id", userId)
      .eq("day_of_week", dayOfWeek);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("workout_schedule").upsert(
      { user_id: userId, day_of_week: dayOfWeek, workout_name: workoutName, time },
      { onConflict: "user_id,day_of_week" }
    );
    if (error) throw error;
  }
  revalidatePath("/fitness");
}

export async function logWorkout(
  date: string,
  workoutName: string,
  source: "scheduled" | "adhoc"
): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("workout_logs").insert({
    user_id: userId,
    date,
    workout_name: workoutName,
    source,
  });
  if (error) throw error;
  revalidatePath("/fitness");
  revalidatePath("/");
}
