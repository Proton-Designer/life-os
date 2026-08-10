"use server";

import { createClient } from "@/lib/supabase/server";
import type { PriorityItem } from "@/lib/home/types";
import { revalidatePath } from "next/cache";
import { markPrayer } from "@/app/(app)/deen/actions";
import { logWorkout } from "@/app/(app)/fitness/actions";

export async function toggleItem(item: PriorityItem): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  switch (item.actionType) {
    case "toggle_prayer": {
      // Home's one-tap checkbox always means "mark on time" — Deen's own page
      // offers the full on_time/qada/missed choice via the same markPrayer action.
      await markPrayer(
        item.date,
        item.actionRefId as "fajr" | "dhuhr" | "asr" | "maghrib" | "isha",
        "on_time"
      );
      break;
    }
    case "toggle_kill_list": {
      const { error } = await supabase
        .from("kill_list_items")
        .update({ completed: true })
        .eq("id", item.actionRefId)
        .eq("user_id", user.id);
      if (error) throw error;
      break;
    }
    case "toggle_task": {
      const { error } = await supabase
        .from("tasks")
        .update({ completed: true })
        .eq("id", item.actionRefId)
        .eq("user_id", user.id);
      if (error) throw error;
      break;
    }
    case "toggle_habit": {
      const { error } = await supabase.from("habit_logs").upsert(
        {
          habit_id: item.actionRefId,
          user_id: user.id,
          date: item.date,
          completed: true,
        },
        { onConflict: "habit_id,date" }
      );
      if (error) throw error;
      break;
    }
    case "toggle_adhkar": {
      const { error } = await supabase.from("adhkar_logs").upsert(
        {
          user_id: user.id,
          date: item.date,
          period: item.actionRefId,
          completed: true,
        },
        { onConflict: "user_id,date,period" }
      );
      if (error) throw error;
      break;
    }
    case "toggle_workout": {
      await logWorkout(item.date, item.actionRefId, "scheduled");
      break;
    }
  }

  revalidatePath("/");
}
