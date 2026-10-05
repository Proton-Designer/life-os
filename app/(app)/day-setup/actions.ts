"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { setUpDayCore, type DaySetupInput } from "@/lib/day-setup/actions-core";

export type SetUpDayResult = { ok: true; bedtime: string; windDownStart: string; stepsCreated: number } | { ok: false; message: string };

/**
 * The guided "Set up your day" (see lib/day-setup/actions-core.ts): sleep plan + optional morning routine, then the two
 * opt-in features switched on. Returned, not thrown, so a refusal's reason reaches the user (Next masks a thrown message
 * in production). Revalidates the whole layout: the shell and Home both read the feature flags.
 */
export async function setUpDay(input: DaySetupInput): Promise<SetUpDayResult> {
  const { supabase, userId } = await requireUser();
  try {
    const result = await setUpDayCore(supabase, userId, input);
    revalidatePath("/", "layout");
    return { ok: true, bedtime: result.plan.bedtime, windDownStart: result.plan.windDownStart, stepsCreated: result.stepsCreated };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't save that. Try again." };
  }
}
