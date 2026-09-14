"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { addDaysToDateString, localDateString } from "@/lib/date-utils";
import { getAllTriggers, getTodayDistractionCount } from "@/lib/distractions/queries";
import { closeBlockers, type CloseBlocker } from "@/lib/evening-close/evening-close";
import type { ReviewItem } from "@/lib/distractions/types";
import { getHoursTodayMinutes } from "@/lib/evening-close/hours-today";
import { getTodayDayStart } from "@/lib/day-structure/day-start";
import { computeDeltaMinutes } from "@/lib/day-structure/delta-clock";

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
   *
   * Computed via lib/evening-close/hours-today.ts (extracted, not
   * reimplemented, so Day Structure's efficiency metric (#35) reads from the
   * exact same day-bounded, counts_toward_hours-filtered query rather than a
   * second copy that can drift from this one).
   */
  hoursTodayMinutes: number;
  /** `user_settings.weekday_baselines` (122). Null = never set: the comparison is ABSENT, not failed. */
  weekdayBaselines: number[] | null;
  /** The USER'S weekday, 0 = Sunday. Computed in their timezone, never the server's. */
  weekdayIndex: number;
  /** Lines already dumped for TOMORROW, so re-entering the ceremony resumes rather than restarts. */
  tomorrowLines: { id: string; title: string }[];
  /**
   * Minutes since today's Start Day tap (#33/#34, Day Structure) — null when
   * Start Day hasn't been tapped today, not zero. A zero here would read as
   * "just woke up a moment ago" for someone who never marked waking at all,
   * the same absent-is-not-a-value trap `weekdayBaselines`/Day Won already
   * guards against. The close only READS today's wake mark to report Delta
   * alongside Hours; it never writes one — that write path is #33's Start
   * Day tap (app/(app)/open/actions.ts) only.
   */
  deltaMinutes: number | null;
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
  const tomorrow = addDaysToDateString(today, 1);

  // The user's weekday, not the server's. `today` is already their local
  // calendar date; a noon UTC instant off that date cannot slip either way.
  const weekdayIndex = new Date(`${today}T12:00:00Z`).getUTCDay();

  const [triggers, unplannedTodayCount, planned, hoursTodayMinutes, tomorrowRows, settings, wakeMark] = await Promise.all([
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
    getHoursTodayMinutes(supabase, user.id, today, timezone, new Date()),
    supabase
      .from("tasks")
      .select("id, title")
      .eq("user_id", user.id)
      .eq("planned_date", tomorrow)
      .order("created_at", { ascending: true }),
    supabase.from("user_settings").select("weekday_baselines").eq("user_id", user.id).maybeSingle(),
    // #33/#34 (Day Structure), read-only.
    getTodayDayStart(supabase, user.id, timezone, new Date()),
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
    hoursTodayMinutes,
    deltaMinutes: wakeMark ? computeDeltaMinutes(wakeMark.wokeAtIso, new Date()) : null,
    tomorrowLines: (tomorrowRows.data ?? []).map((t) => ({ id: t.id, title: t.title })),
    todaysThree: (planned.data ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      mitRank: t.mit_rank as number,
      completed: t.completed,
    })),
  };
}
