"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, requireUser, getProfile } from "@/lib/supabase/auth";
import type { PriorityItem } from "@/lib/home/types";
import { getNotifications, type NotificationItem } from "@/lib/notifications/get-notifications";
import { markNotificationRead } from "@/lib/notifications/mark-read";
import { localDateString, getWeekStartDate, addDaysToDateString } from "@/lib/date-utils";
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
    case "open_fitness": {
      // Navigates (next-actions.tsx renders a Link, not a checkbox) — never
      // toggles. Throws rather than silently no-opping so a future change
      // that accidentally routes this into the toggle path fails loudly
      // instead of half-working (docs/superpowers/specs/
      // 2026-08-23-home-fitness-row.md).
      throw new Error("open_fitness items navigate to /fitness and cannot be toggled");
    }
  }

  revalidatePath("/");
}

/**
 * Weekly goal editing (2026-08-20: relocated from the removed Weekly
 * Planning page into Home's "This week's focus" panel — see
 * components/home/weekly-focus.tsx). Behavior unchanged: upserts this
 * week's row, then locks last week's row on this week's first save, per
 * the "past weeks are locked/read-only once the week ends" rule.
 */
export async function saveWeeklyGoal(
  domain: "deen" | "business",
  headline: string,
  milestones: string[],
  quranPageTarget?: number,
  now: Date = new Date()
): Promise<void> {
  const { supabase, userId } = await requireUser();

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const currentWeekStart = getWeekStartDate(localDateString(now, timezone));
  const previousWeekStart = addDaysToDateString(currentWeekStart, -7);

  const { error: upsertError } = await supabase.from("weekly_goals").upsert(
    {
      user_id: userId,
      week_start_date: currentWeekStart,
      domain,
      headline,
      milestones,
      quran_page_target: quranPageTarget ?? null,
    },
    { onConflict: "user_id,week_start_date,domain" }
  );
  if (upsertError) throw upsertError;

  const { data: previousWeek } = await supabase
    .from("weekly_goals")
    .select("id, locked")
    .eq("user_id", userId)
    .eq("week_start_date", previousWeekStart)
    .eq("domain", domain)
    .maybeSingle();

  if (previousWeek && !previousWeek.locked) {
    const { error: lockError } = await supabase
      .from("weekly_goals")
      .update({ locked: true })
      .eq("id", previousWeek.id);
    if (lockError) throw lockError;
  }

  revalidatePath("/");
  // Home and the /calendar route now share this same WeeklyGoalsHeader
  // component and Server Action — the route's own server-rendered data
  // needs revalidating too, not just Home's (the topbar's calendar dialog
  // refetches its own client-side copy after save instead of relying on
  // this).
  revalidatePath("/calendar");
}
