import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString, resolveLocalTime } from "@/lib/date-utils";
import { sendPushToUser } from "./send-push";

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

const REMINDER_WINDOW_START_LOCAL = "21:30";
const REMINDER_WINDOW_DURATION_MS = 2 * 60 * 60 * 1000;

const REMINDER_TITLE = "Wind down";
const REMINDER_BODY = "It's 9:30 PM — a good time to plan tomorrow and get some rest.";

function isWithinReminderWindow(now: Date, timezone: string, sentDate: string): boolean {
  const windowStart = resolveLocalTime(sentDate, REMINDER_WINDOW_START_LOCAL, timezone);
  const windowEnd = new Date(windowStart.getTime() + REMINDER_WINDOW_DURATION_MS);
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

  let dispatched = 0;
  for (const profile of profiles) {
    const timezone = profile.timezone ?? "UTC";
    const sentDate = localDateString(now, timezone);

    if (!isWithinReminderWindow(now, timezone, sentDate)) continue;

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
