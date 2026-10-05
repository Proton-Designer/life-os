import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDateString, localDateString, resolveLocalTime } from "@/lib/date-utils";
import { deriveWindDown, eveningWindDownStart } from "@/lib/rhythm/wind-down";
import { sendPushToUser } from "./send-push";
import { DEFAULT_WIND_DOWN } from "@/lib/home/rhythm-state";

/**
 * P2-05: a fixed 9:30 PM local nudge for any user who opted in via
 * `profiles.sleep_reminder_enabled` (Settings). Same claim-first
 * idempotency and per-user timezone-aware window shape as
 * `due-card-notification.ts` (#10) -- this track's own P2-02 work tonight
 * (`lib/ai/morning-brief.ts`) already proved the pattern out a second
 * time, so a third instance reuses it rather than inventing a new shape.
 *
 * WHY A NARROWER 2h WINDOW THAN #10's 3h ONE: #10's window absorbs missed
 * cron ticks for a check that depends on real due-item state (worth
 * retrying broadly). This is a single fixed clock-time nudge -- 2 hours
 * ([21:30, 23:30)) is plenty of retry room for missed 15-minute ticks
 * without drifting into "why did I get a 9:30 reminder at 11pm" territory.
 * No per-user setting for the exact minute exists (confirmed the same way
 * due-card-notification.ts's own header confirmed it for checkin_window_
 * start) -- logged as an assumption in $SD/OPEN_QUESTIONS.md.
 */

// ONE default for "when does the evening start": the SAME constant Home's "Close the day" card flips on (lib/home/rhythm-state.ts),
// so with no wind-down plan the push and the card can never disagree (they used to: 21:30 vs 21:00).
const REMINDER_WINDOW_START_LOCAL = DEFAULT_WIND_DOWN;
// Latest local time the reminder window may open (see reminderWindowStartLocal).
const REMINDER_LATEST_START = "23:30";
const REMINDER_WINDOW_DURATION_MS = 2 * 60 * 60 * 1000;

const REMINDER_TITLE = "Wind down";
const REMINDER_BODY = "Time to wind down — close the day and plan tomorrow.";

/**
 * IA-P4a: the window opens at the user's own wind-down start when they set a wind-down plan
 * (user_settings, derived by lib/rhythm/wind-down.ts), else at the old fixed 21:30. It is 2h long
 * but never runs past local midnight (sentDate is the local day, so a 23:15 start gets 45 min).
 */
export function reminderWindowStartLocal(plan: { wake_time: string | null; sleep_need_minutes: number | null; wind_down_minutes: number | null } | undefined): string {
  const derived = plan ? deriveWindDown({ wakeTime: plan.wake_time, sleepNeedMinutes: plan.sleep_need_minutes, windDownMinutes: plan.wind_down_minutes }) : null;
  const start = eveningWindDownStart(derived) ?? REMINDER_WINDOW_START_LOCAL;
  // The cron ticks every 15 min and the window stops at local midnight: a start after 23:30 would get
  // under 30 min and could be missed entirely, so it opens no later than REMINDER_LATEST_START.
  return start > REMINDER_LATEST_START ? REMINDER_LATEST_START : start;
}

function isWithinReminderWindow(now: Date, timezone: string, sentDate: string, startLocal: string = REMINDER_WINDOW_START_LOCAL): boolean {
  const windowStart = resolveLocalTime(sentDate, startLocal, timezone);
  const midnight = resolveLocalTime(addDaysToDateString(sentDate, 1), "00:00", timezone);
  const windowEnd = new Date(Math.min(windowStart.getTime() + REMINDER_WINDOW_DURATION_MS, midnight.getTime()));
  return now.getTime() >= windowStart.getTime() && now.getTime() < windowEnd.getTime();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

async function claimSendSlot(supabase: SupabaseClient, userId: string, sentDate: string): Promise<boolean> {
  const { error } = await supabase.from("sleep_reminder_log").insert({ user_id: userId, sent_date: sentDate });
  if (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
  return true;
}

async function releaseSendSlot(supabase: SupabaseClient, userId: string, sentDate: string): Promise<void> {
  const { error } = await supabase.from("sleep_reminder_log").delete().eq("user_id", userId).eq("sent_date", sentDate);
  if (error) throw error;
}

export interface SleepReminderDispatchResult {
  /** Users who opted in via profiles.sleep_reminder_enabled -- the pool this tick considered. */
  usersChecked: number;
  dispatched: number;
}

export async function dispatchSleepReminders(supabase: SupabaseClient, now: Date): Promise<SleepReminderDispatchResult> {
  const { data: profileRows, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, timezone")
    .eq("sleep_reminder_enabled", true)
    // Opt-in feature gate (RS-01): the reminder belongs to the Sleep plan feature, OFF by default.
    .contains("enabled_features", ["sleep_plan"]);
  if (profileError) throw profileError;
  const profiles = (profileRows ?? []) as { user_id: string; timezone: string | null }[];
  if (profiles.length === 0) return { usersChecked: 0, dispatched: 0 };

  // IA-P4a: per-user wind-down start (user_settings), read in one query for the opted-in pool.
  const { data: settingsRows, error: settingsError } = await supabase
    .from("user_settings")
    .select("user_id, wake_time, sleep_need_minutes, wind_down_minutes")
    .in("user_id", profiles.map((p) => p.user_id));
  if (settingsError) throw settingsError;
  const settingsByUser = new Map(
    ((settingsRows ?? []) as { user_id: string; wake_time: string | null; sleep_need_minutes: number | null; wind_down_minutes: number | null }[]).map((r) => [r.user_id, r])
  );

  let dispatched = 0;
  for (const profile of profiles) {
    const timezone = profile.timezone ?? "UTC";
    const sentDate = localDateString(now, timezone);

    if (!isWithinReminderWindow(now, timezone, sentDate, reminderWindowStartLocal(settingsByUser.get(profile.user_id)))) continue;

    // THE LOCK: claim before ever attempting a push. A false return means
    // someone else already holds it (a real prior send today, or a
    // concurrent tick that won) -- skip without calling sendPushToUser.
    if (!(await claimSendSlot(supabase, profile.user_id, sentDate))) continue;

    const result = await sendPushToUser(supabase, profile.user_id, REMINDER_TITLE, REMINDER_BODY, "/close");
    if (result.delivered > 0) {
      dispatched++;
    } else {
      // No subscription, or every device rejected it -- release so a
      // later tick (still inside today's window) can retry.
      await releaseSendSlot(supabase, profile.user_id, sentDate);
    }
  }

  return { usersChecked: profiles.length, dispatched };
}
