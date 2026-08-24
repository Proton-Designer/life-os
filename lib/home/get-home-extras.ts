import { createClient } from "@/lib/supabase/server";
import { localDateString, resolveLocalTime, addDaysToDateString } from "@/lib/date-utils";
import { computeFocusTimeMinutes } from "@/lib/business/focus-time";

export type FocusKindExtras = {
  minutes: number;
  sessions: number;
};

export type HomeExtras = {
  deepWork: FocusKindExtras;
  deepStudy: FocusKindExtras;
};

// Slimmed to just today's focus time (2026-08-17 day-shape spec) — the
// 7-day completion trend moved to lib/home/get-weekly-completion.ts,
// following the chart to Insights. Split into deepWork/deepStudy
// (2026-08-24) — the Home Focus module shows both kinds as separate rows,
// each with its own minutes/session count and Lock In button.
export async function getHomeExtras(
  userId: string,
  now: Date,
  profile: { timezone: string } | null
): Promise<HomeExtras> {
  const supabase = await createClient();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(now, timezone);

  // Bounds must be the LOCAL day converted to instants, not a UTC-day
  // string — `${todayStr}T00:00:00Z` treats an already-local date as if it
  // were a UTC boundary, which is off by the timezone offset. For Chicago
  // (UTC-5) that pulled in the last 5 hours of the *previous* local
  // evening as if they were today. See lib/home/get-day-shape.ts for the
  // sibling bug and its test proving the boundary with a real
  // timezone-offset-crossing session.
  const dayStart = resolveLocalTime(todayStr, "00:00", timezone).toISOString();
  const dayEnd = resolveLocalTime(addDaysToDateString(todayStr, 1), "00:00", timezone).toISOString();
  const { data: workSessionRows } = await supabase
    .from("work_sessions")
    .select("started_at, ended_at, kind")
    .eq("user_id", userId)
    .gte("started_at", dayStart)
    .lt("started_at", dayEnd);

  const rows = workSessionRows ?? [];
  const forKind = (kind: "deep_work" | "deep_study"): FocusKindExtras => {
    const sessions = rows.filter((s) => s.kind === kind);
    return {
      minutes: computeFocusTimeMinutes(
        sessions.map((s) => ({ startedAt: new Date(s.started_at), endedAt: s.ended_at ? new Date(s.ended_at) : null })),
        now
      ),
      sessions: sessions.length,
    };
  };

  return {
    deepWork: forKind("deep_work"),
    deepStudy: forKind("deep_study"),
  };
}
