"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { untypedFrom } from "@/lib/self-mastery/untyped-from";
import { recordVerdictCore } from "./actions-core";
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

/** Postgres error codes we can turn into a sentence — used by promoteLesson below. recordVerdict's own codes (including 55000, migration 128's retired-promotion guard) moved to actions-core.ts's recordVerdictCore with it. */
const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

function pgCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

export async function promoteLesson(input: {
  lessonId: string;
  acceptedText: string;
  areaId: string;
}): Promise<ActionResult<{ promotionId: string }>> {
  const acceptedText = input.acceptedText.trim();

  // Validate here AND let the database's own CHECK stand. This is not
  // duplication for its own sake: the CHECK
  // (`length(btrim(accepted_text)) > 0`) is the guarantee, and this is the
  // sentence. Without it the user gets GENERIC for a thing they can fix.
  if (!acceptedText) {
    return { ok: false, message: "Write what you're actually going to do — even one line." };
  }
  if (!input.areaId) {
    return { ok: false, message: "Choose which area of your life this belongs to." };
  }

  const { supabase } = await requireUser();

  const { data, error } = await untypedFrom(supabase, "lesson_promotions")
    .insert({
      // user_id is set by trigger from the caller, never from client input
      // (set_user_id_from_caller). Sending it would be ignored at best.
      lesson_id: input.lessonId,
      area_id: input.areaId,
      accepted_text: acceptedText,
    })
    .select("id")
    .returns<{ id: string }[]>();

  if (error) {
    switch (pgCode(error)) {
      case UNIQUE_VIOLATION:
        // lesson_promotions_active_per_lesson. Not an error the user caused
        // twice — usually a second tab, or a back-button resubmit.
        return { ok: false, message: "You're already testing this lesson. Give the current run its verdict first." };
      case FK_VIOLATION:
        return { ok: false, message: "That area is no longer available. Pick another one." };
      case CHECK_VIOLATION:
        return { ok: false, message: "Write what you're actually going to do — even one line." };
      default:
        return { ok: false, message: GENERIC };
    }
  }

  // ROW_COUNT SURFACED, not assumed (R15). A PostgREST insert that matches no
  // row returns `data: []` with NO error — RLS refusing the write looks
  // exactly like success to a caller that only checks `error`. This is the
  // shape that has bitten this codebase before, so it is checked explicitly.
  const inserted = data?.[0];
  if (!inserted) {
    return { ok: false, message: "That didn't save. You may have been signed out — reload and try again." };
  }

  revalidatePath("/personal/self_mastery");
  revalidatePath("/close");
  return { ok: true, promotionId: inserted.id };
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
