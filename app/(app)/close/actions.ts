"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { addDaysToDateString, localDateString } from "@/lib/date-utils";
import { getAllTriggers, getTodayDistractionCount } from "@/lib/distractions/queries";
import { closeBlockers, type CloseBlocker } from "@/lib/evening-close/evening-close";
import type { ReviewItem } from "@/lib/distractions/types";
import { computeFocusTimeMinutes } from "@/lib/business/focus-time";
import { resolveLocalTime } from "@/lib/date-utils";

export type PlannedItem = { id: string; title: string; mitRank: number; completed: boolean };

export type EveningCloseData = {
  /** Local date the close is for, computed in the USER'S timezone. */
  dateLabel: string;
  blockers: CloseBlocker[];
  /**
   * The blocking triggers as full ReviewItems, so the rewrite UI can be mounted
   * INLINE in the account stage (R61 corrected). Without these the stage could
   * only link out to /review — and once /review redirects here that link is a
   * loop with no way to rewrite, which makes the close permanently
   * uncompletable for anyone with a three-strike plan.
   */
  blockingItems: ReviewItem[];
  unplannedTodayCount: number;
  /**
   * What last night's close crowned and starred FOR today — read back so the
   * reflect stage can ask whether it happened. Empty is a real answer ("no
   * plan was made"), not a loading state and not an error.
   */
  todaysThree: PlannedItem[];
  /**
   * Minutes of today's deep-work-class sessions (R58). Baseline and Day Won
   * are deliberately ABSENT until migration 122 gives them a value — an unset
   * baseline is not a zero baseline, and rendering "0 / 0" would read as a
   * failed day rather than an unanswered question.
   */
  hoursTodayMinutes: number;
  /** `user_settings.weekday_baselines` (122). Null = never set: the comparison is ABSENT, not failed. */
  weekdayBaselines: number[] | null;
  /** The USER'S weekday, 0 = Sunday. Computed in their timezone, never the server's. */
  weekdayIndex: number;
  /** Lines already dumped for TOMORROW, so re-entering the ceremony resumes rather than restarts. */
  tomorrowLines: { id: string; title: string }[];
};

/**
 * The evening close's account stage, server-side.
 *
 * THE DATE IS THE USER'S, NOT THE SERVER'S. `localDateString(now, timezone)` —
 * never `new Date()` alone and never Postgres `current_date`, which is UTC. The
 * close runs at night by definition, which is exactly when a UTC-derived date
 * is already tomorrow for anyone west of Greenwich; this codebase has shipped
 * that bug four separate times, and every one of them was in evening-adjacent
 * code.
 */
export async function getEveningCloseData(): Promise<EveningCloseData | null> {
  const user = await getAuthedUser();
  if (!user) return null;

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const today = localDateString(new Date(), timezone);

  const supabase = await createClient();
  // Day bounds from the user's local midnight, via resolveLocalTime — never
  // `${today}T00:00:00Z`, which treats an already-local date as a UTC boundary
  // and pulls in the previous evening. That exact bug has shipped twice here.
  const tomorrow = addDaysToDateString(today, 1);
  const dayStart = resolveLocalTime(today, "00:00", timezone).toISOString();
  const dayEnd = resolveLocalTime(today, "23:59", timezone).toISOString();

  // The user's weekday, not the server's. `today` is already their local
  // calendar date; a noon UTC instant off that date cannot slip either way.
  const weekdayIndex = new Date(`${today}T12:00:00Z`).getUTCDay();

  const [triggers, unplannedTodayCount, planned, sessions, tomorrowRows, settings] = await Promise.all([
    getAllTriggers(supabase, user.id, today),
    getTodayDistractionCount(supabase, user.id, today),
    // Migration 113's columns. Ranked rows only — a null mit_rank means
    // "dumped, not starred", which is a real state and deliberately not part
    // of today's three.
    supabase
      .from("tasks")
      .select("id, title, mit_rank, completed")
      .eq("user_id", user.id)
      .eq("planned_date", today)
      .not("mit_rank", "is", null)
      .order("mit_rank", { ascending: true }),
    // Filter on the GENERATED column, never a hardcoded kind list — migration
    // 057 makes counts_toward_hours unwritable by application code precisely
    // so this answer cannot drift between the surfaces that ask it.
    supabase
      .from("work_sessions")
      .select("started_at, ended_at")
      .eq("user_id", user.id)
      .eq("counts_toward_hours", true)
      .gte("started_at", dayStart)
      .lt("started_at", dayEnd),
    supabase
      .from("tasks")
      .select("id, title")
      .eq("user_id", user.id)
      .eq("planned_date", tomorrow)
      .order("created_at", { ascending: true }),
    supabase.from("user_settings").select("weekday_baselines").eq("user_id", user.id).maybeSingle(),
  ]);

  const blockers = closeBlockers({ triggers, unplannedTodayCount });
  const blockingIds = new Set(blockers.map((b) => b.triggerId));

  return {
    dateLabel: today,
    blockers,
    blockingItems: triggers
      .filter((t) => blockingIds.has(t.id))
      // isNew is false: a blocking trigger by definition HAS a plan — it has
      // one that has failed three times. Claiming otherwise would render the
      // "write your first plan" affordance instead of the rewrite.
      .map((t) => ({ trigger: t, todayCount: t.todayCount, isNew: false })),
    unplannedTodayCount,
    weekdayBaselines: (settings.data?.weekday_baselines ?? null) as number[] | null,
    weekdayIndex,
    hoursTodayMinutes: computeFocusTimeMinutes(
      (sessions.data ?? []).map((s) => ({
        startedAt: new Date(s.started_at),
        endedAt: s.ended_at ? new Date(s.ended_at) : null,
      })),
      new Date()
    ),
    tomorrowLines: (tomorrowRows.data ?? []).map((t) => ({ id: t.id, title: t.title })),
    todaysThree: (planned.data ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      mitRank: t.mit_rank as number,
      completed: t.completed,
    })),
  };
}
