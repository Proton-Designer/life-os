import { createClient } from "@/lib/supabase/server";
import { localDateString } from "@/lib/date-utils";
import { computeFocusTimeMinutes } from "@/lib/business/focus-time";

export type HomeExtras = {
  focusTimeMinutes: number;
  focusSessionCount: number;
};

// Slimmed to just today's focus time (2026-08-17 day-shape spec) — the
// 7-day completion trend moved to lib/home/get-weekly-completion.ts,
// following the chart to Insights.
export async function getHomeExtras(
  userId: string,
  now: Date,
  profile: { timezone: string } | null
): Promise<HomeExtras> {
  const supabase = await createClient();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(now, timezone);

  const { data: workSessionRows } = await supabase
    .from("work_sessions")
    .select("started_at, ended_at")
    .eq("user_id", userId)
    .gte("started_at", `${todayStr}T00:00:00Z`);

  const focusTimeMinutes = computeFocusTimeMinutes(
    (workSessionRows ?? []).map((s) => ({ startedAt: new Date(s.started_at), endedAt: s.ended_at ? new Date(s.ended_at) : null })),
    now
  );

  return {
    focusTimeMinutes,
    focusSessionCount: (workSessionRows ?? []).length,
  };
}
