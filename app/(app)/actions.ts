"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, requireUser, getProfile } from "@/lib/supabase/auth";
import type { PriorityItem } from "@/lib/home/types";
import { getNotifications, type NotificationItem } from "@/lib/notifications/get-notifications";
import { markNotificationRead } from "@/lib/notifications/mark-read";
import { localDateString, getWeekStartDate, addDaysToDateString } from "@/lib/date-utils";
import { revalidatePath } from "next/cache";
import { revalidateBusinessScreens } from "@/lib/work/revalidate-screens";
import { redirect } from "next/navigation";
import { markPrayer } from "@/app/(app)/deen/actions";
import { saveBusinessWeeklyGoalCore } from "@/lib/business/actions-core";
import { saveDeenWeeklyGoalCore } from "@/lib/deen/actions-core";
import { isDeenModeOnForRequest } from "@/lib/deen/deen-mode-guard";
import { isDeenModeOn } from "@/lib/deen/deen-mode";

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

/**
 * PRIVACY fix (Opus Lead ruling, 2026-09-18), not just staleness, and the
 * other half of the same fix as app/login/actions.ts's signIn: this is the
 * moment a departing user's cached content should be actively discarded,
 * not left sitting in the client Router Cache for whoever uses this device
 * next. signIn's own revalidate only proves a stale entry gets busted on
 * the way IN to a new session — this proves the departing side does its
 * part too, so a shared-device handoff isn't relying on one leg alone.
 * Layout-level, same reasoning as signIn/completeOnboarding: the nav shell
 * itself is per-account. Before redirect() — it works by throwing, so a
 * call placed after it never runs.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
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
      // Deen Mode OFF: refuse (no-op) -- the row should not exist, but a Server
      // Action is a public endpoint. Data untouched.
      if (!(await isDeenModeOnForRequest())) return;
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
        .update({ completed: true, completed_at: new Date().toISOString() })
        .eq("id", item.actionRefId)
        .eq("user_id", user.id);
      if (error) throw error;
      break;
    }
    case "toggle_task": {
      const { error } = await supabase
        .from("tasks")
        .update({ completed: true, completed_at: new Date().toISOString() })
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
      if (!(await isDeenModeOnForRequest())) return;
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

  // Hot tap: no revalidatePath here (it made every tap wait for a full Home
  // re-render). Callers schedule ONE deferred refreshHome() after a burst (PERF-2).
}

/**
 * Data-free cache revalidation scheduled by Home's tap controls after a burst of
 * toggleItem calls. Covers Home plus the Deen surfaces a prayer/adhkar row feeds
 * (markPrayer no longer revalidates /deen itself).
 */
export async function refreshHome(): Promise<void> {
  await requireUser();
  revalidatePath("/");
  revalidatePath("/deen");
  revalidatePath("/personal/[subdomain]", "page");
}

/**
 * Weekly goal editing (2026-08-20: relocated from the removed Weekly
 * Planning page into Home's "This week's focus" panel — see
 * components/home/weekly-focus.tsx). Behavior unchanged: upserts this
 * week's row, then locks last week's row on this week's first save, per
 * the "past weeks are locked/read-only once the week ends" rule.
 *
 * P4-06: the upsert itself now goes through the same per-domain core the
 * MCP write tool uses (saveBusinessWeeklyGoalCore /
 * saveDeenWeeklyGoalCore — both plain upserts, deliberately no
 * locking/carry-forward of their own, see saveBusinessWeeklyGoalCore's own
 * header). The lock-previous-week step below stays HERE, cookie-only, for
 * both domains alike — business.weekly_goal.save's MCP path has never had
 * it either, so this doesn't introduce a new cookie-vs-MCP asymmetry, only
 * preserves the one that already existed for business.
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
  if (domain === "deen" && !isDeenModeOn(profile)) return;
  const timezone = profile?.timezone ?? "UTC";
  const currentWeekStart = getWeekStartDate(localDateString(now, timezone));
  const previousWeekStart = addDaysToDateString(currentWeekStart, -7);

  if (domain === "business") {
    await saveBusinessWeeklyGoalCore(supabase, userId, currentWeekStart, headline, milestones);
  } else {
    await saveDeenWeeklyGoalCore(supabase, userId, currentWeekStart, headline, milestones, quranPageTarget ?? null);
  }

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
  // IA-P1b: the Business weekly_goal widget edits through this same action, and the Business
  // screen is served at /business or /work/<tab>.
  if (domain === "business") revalidateBusinessScreens();
}
