"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { getAllTriggers, getTodayDistractionCount } from "@/lib/distractions/queries";
import { closeBlockers, type CloseBlocker } from "@/lib/evening-close/evening-close";

export type EveningCloseData = {
  /** Local date the close is for, computed in the USER'S timezone. */
  dateLabel: string;
  blockers: CloseBlocker[];
  unplannedTodayCount: number;
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
  const [triggers, unplannedTodayCount] = await Promise.all([
    getAllTriggers(supabase, user.id, today),
    getTodayDistractionCount(supabase, user.id, today),
  ]);

  return {
    dateLabel: today,
    blockers: closeBlockers({ triggers, unplannedTodayCount }),
    unplannedTodayCount,
  };
}
