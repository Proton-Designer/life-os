"use server";

import { revalidatePath } from "next/cache";
import { getProfile, requireUser } from "@/lib/supabase/auth";
import { effectiveDayString } from "@/lib/date-utils";
import { saveGapAnswersCore } from "@/lib/checkins/gaps-core";
import type { GapAnswer } from "@/lib/checkins/gaps";

/**
 * Saves the evening close's "Your untracked time" answers for the day being closed (the 4 AM-rollover day, same as the
 * rest of the close). The stretches are recomputed on the server and every answer is checked against them; each is stored as
 * an allocation check-in (lib/checkins/gaps-core.ts). /close is deliberately NOT revalidated: the answered stretches would
 * vanish from under the card that is showing its own "saved" summary.
 */
export async function saveUntrackedGaps(answers: GapAnswer[]): Promise<{ saved: number }> {
  const { supabase, userId } = await requireUser();
  const profile = await getProfile();
  const now = new Date();
  const dateStr = effectiveDayString(now, profile?.timezone ?? "UTC");
  const result = await saveGapAnswersCore(supabase, userId, dateStr, now, answers);
  revalidatePath("/");
  revalidatePath("/insights");
  return result;
}
