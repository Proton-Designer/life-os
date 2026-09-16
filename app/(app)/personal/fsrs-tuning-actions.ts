"use server";

import { requireUser } from "@/lib/supabase/auth";
import { getFsrsTuningStatus as getFsrsTuningStatusCore, runFsrsTuning, FSRS_TUNING_MIN_REVIEWS, type FsrsTuningStatus } from "@/lib/self-mastery/fsrs-tuning";

export type { FsrsTuningStatus };
export { FSRS_TUNING_MIN_REVIEWS };

export async function getFsrsTuningStatus(): Promise<FsrsTuningStatus> {
  const { supabase, userId } = await requireUser();
  return getFsrsTuningStatusCore(supabase, userId);
}

export interface FsrsTuningActionResult {
  ok: boolean;
  message: string;
}

/**
 * Server Action wrapper only -- all the real work (gate, cooldown,
 * identity, the service-role write) lives in `runFsrsTuning` itself, per
 * the Lead's ruling that identity must come from `requireUser()` inside
 * that function, never threaded through as an argument here.
 */
export async function triggerFsrsTuning(): Promise<FsrsTuningActionResult> {
  try {
    const result = await runFsrsTuning();
    return { ok: true, message: `Tuned on ${result.reviewCount} reviews.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Tuning failed unexpectedly. Try again." };
  }
}
