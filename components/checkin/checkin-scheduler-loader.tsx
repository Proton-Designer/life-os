import { CheckinScheduler } from "./checkin-scheduler";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, resolveLocalTime } from "@/lib/date-utils";

// Deliberately its own async Server Component, rendered inside a
// <Suspense fallback={null}> boundary in AppShell rather than awaited
// directly there — this data isn't needed for the static shell (nav, page
// content) to render, so it shouldn't block it. See the "push dynamic
// access down" pattern in node_modules/next/dist/docs/01-app/02-guides/streaming.md.
export async function CheckinSchedulerLoader() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) return null;

  const profile = await getProfile();
  if (!profile) return null;

  const timezone = profile.timezone;
  const todayStr = localDateString(new Date(), timezone);
  const localMidnight = resolveLocalTime(todayStr, "00:00", timezone);
  const nextLocalMidnight = new Date(localMidnight.getTime() + 24 * 60 * 60 * 1000);
  const { data: answeredRows } = await supabase
    .from("checkins")
    .select("checkin_time")
    .eq("user_id", user.id)
    .eq("answered", true)
    .gte("checkin_time", localMidnight.toISOString())
    .lt("checkin_time", nextLocalMidnight.toISOString());

  return (
    <CheckinScheduler
      timezone={timezone}
      windowStart={profile.checkin_window_start.slice(0, 5)}
      windowEnd={profile.checkin_window_end.slice(0, 5)}
      intervalMinutes={profile.checkin_interval_minutes}
      pausedDate={profile.paused_date}
      answeredSlotTimesIso={(answeredRows ?? []).map((r) => r.checkin_time)}
    />
  );
}
