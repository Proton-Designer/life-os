"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { promoteLessonCore, recordVerdictCore } from "./actions-core";
import type { ActionResult, Verdict } from "./types";

/**
 * The two writes of the loop seam.
 *
 * R15 THROUGHOUT: every failure is a returned value with a message a person
 * can act on, never a swallowed error and never a thrown one that renders as
 * a generic boundary. A promotion the user believes they made and did not is
 * the specific harm here — the whole feature is a promise the app keeps for
 * thirty days.
 */

const GENERIC = "Something went wrong. Nothing was saved — please try again.";

/**
 * P4-08: THIN WRAPPER over promoteLessonCore (lib/promotions/actions-core.ts,
 * L6/R5) — the MCP write tool calls the same core. Same translation
 * discipline `recordVerdict` below already established: the core throws
 * with the exact message strings this function used to return directly, so
 * this is a plain try/catch, not a re-derivation (R15: every failure is a
 * returned value to this function's own callers, never a thrown one).
 */
export async function promoteLesson(input: {
  lessonId: string;
  acceptedText: string;
  areaId: string;
}): Promise<ActionResult<{ promotionId: string }>> {
  const { supabase, userId } = await requireUser();

  let result;
  try {
    result = await promoteLessonCore(supabase, userId, input);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : GENERIC };
  }

  revalidatePath("/personal/self_mastery");
  revalidatePath("/close");
  return { ok: true, promotionId: result.promotionId };
}

/**
 * R5 THIN WRAPPER over `recordVerdictCore` (lib/promotions/actions-core.ts,
 * L6/R5) — the logic (the abandoned-needs-reason check, the retired-
 * promotion guard, the Postgres-error-code mapping) moved there verbatim so
 * the MCP write path can reach the identical business logic with zero
 * duplication. This function's only remaining job is the cookie-authed
 * boundary (`requireUser()`) and translating a thrown error back into the
 * `ActionResult` shape this Server Action has always returned to its own
 * UI (R15: every failure is a returned value, never a thrown one that
 * renders as a generic boundary) — `recordVerdictCore` throws with the
 * EXACT same message strings this function used to return directly, so
 * that translation is a plain try/catch, not a re-derivation.
 */
export async function recordVerdict(input: {
  promotionId: string;
  verdict: Verdict;
  reason?: string;
}): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();

  try {
    await recordVerdictCore(supabase, userId, input);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : GENERIC };
  }

  revalidatePath("/close");
  revalidatePath("/personal/self_mastery");
  return { ok: true };
}
