"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { getAllTriggers, getTodayDistractionCount } from "@/lib/distractions/queries";
import { closeBlockers, type CloseBlocker } from "@/lib/evening-close/evening-close";

export type PlannedItem = { id: string; title: string; mitRank: number; completed: boolean };

export type EveningCloseData = {
  /** Local date the close is for, computed in the USER'S timezone. */
  dateLabel: string;
  blockers: CloseBlocker[];
  unplannedTodayCount: number;
  /**
   * What last night's close crowned and starred FOR today — read back so the
   * reflect stage can ask whether it happened. Empty is a real answer ("no
   * plan was made"), not a loading state and not an error.
   */
  todaysThree: PlannedItem[];
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
  const [triggers, unplannedTodayCount, planned] = await Promise.all([
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
  ]);

  return {
    dateLabel: today,
    blockers: closeBlockers({ triggers, unplannedTodayCount }),
    unplannedTodayCount,
    todaysThree: (planned.data ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      mitRank: t.mit_rank as number,
      completed: t.completed,
    })),
  };
}
