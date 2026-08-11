import { TopNav } from "./top-nav";
import { MobileIsland } from "./mobile-island";
import { CheckinScheduler } from "@/components/checkin/checkin-scheduler";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { localDateString, resolveLocalTime } from "@/lib/date-utils";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const user = await getAuthedUser();

  let checkinProps: {
    timezone: string;
    windowStart: string;
    windowEnd: string;
    intervalMinutes: number;
    pausedDate: string | null;
    answeredSlotTimesIso: string[];
  } | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select(
        "timezone, checkin_window_start, checkin_window_end, checkin_interval_minutes, paused_date"
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (profile) {
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

      checkinProps = {
        timezone,
        windowStart: profile.checkin_window_start.slice(0, 5),
        windowEnd: profile.checkin_window_end.slice(0, 5),
        intervalMinutes: profile.checkin_interval_minutes,
        pausedDate: profile.paused_date,
        answeredSlotTimesIso: (answeredRows ?? []).map((r) => r.checkin_time),
      };
    }
  }

  return (
    <>
      <TopNav />
      <main className="pt-0 pb-24 md:pt-14 md:pb-0">{children}</main>
      <MobileIsland />
      {checkinProps && <CheckinScheduler {...checkinProps} />}
    </>
  );
}
