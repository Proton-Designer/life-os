"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, requireUser, getProfile } from "@/lib/supabase/auth";
import type { PriorityItem } from "@/lib/home/types";
import { getNotifications, type NotificationItem } from "@/lib/notifications/get-notifications";
import { markNotificationRead } from "@/lib/notifications/mark-read";
import { localDateString } from "@/lib/date-utils";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { markPrayer } from "@/app/(app)/deen/actions";

/** Client-callable wrapper — NotificationsBell polls this rather than calling the server-only getNotifications directly. */
export async function getNotificationsForNow(nowIso: string): Promise<NotificationItem[]> {
  const { userId } = await requireUser();
  return getNotifications(userId, new Date(nowIso));
}

/**
 * `nowIso` (not a pre-computed date string) so the user-local date is
 * derived server-side from their own profile timezone, same as
 * getNotifications itself — see that function's header for why the date
 * must be local, never UTC.
 */
export async function markNotificationReadForNow(notificationKey: string, nowIso: string): Promise<void> {
  const { userId } = await requireUser();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(new Date(nowIso), timezone);
  await markNotificationRead(userId, notificationKey, dateStr);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function toggleItem(item: PriorityItem): Promise<void> {
  const supabase = await createClient();
  const user = await getAuthedUser();

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
  }

  revalidatePath("/");
}
