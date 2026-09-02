"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { untypedFrom } from "@/lib/self-mastery/untyped-from";
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

/** Postgres error codes we can turn into a sentence. */
const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
/**
 * 55000 object_not_in_prerequisite_state — raised by `128`'s trigger when a
 * verdict is submitted on an already-retired promotion. Deliberately NOT
 * check_violation: this table already maps check_violation to the
 * abandoned-needs-a-reason CHECK, and two refusals sharing one code means one
 * of them answers the user's question wrongly.
 */
const NOT_IN_PREREQUISITE_STATE = "55000";

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

export async function recordVerdict(input: {
  promotionId: string;
  verdict: Verdict;
  reason?: string;
}): Promise<ActionResult> {
  const reason = (input.reason ?? "").trim();

  // `lesson_verdicts_abandoned_needs_reason` enforces this; the sentence is
  // ours. Abandoning without saying why turns the log into a list of
  // failures with no lesson in it, which is the opposite of the point.
  if (input.verdict === "abandoned" && !reason) {
    return { ok: false, message: "Say what didn't work. A month from now that sentence is the whole value." };
  }

  const { supabase, userId } = await requireUser();

  // GUARD: a retired promotion takes no further verdicts.
  //
  // THIS READ IS NOT THE GUARANTEE — `128`'s BEFORE INSERT trigger is, and it
  // is caught below as 55000. This check exists to give the common cases (a
  // stale evening close left open overnight, a double submit) a kind sentence
  // and a cheap exit instead of a database exception. Until `128` is applied
  // to production it is also the ONLY protection, and a read-then-write can
  // lose a race with a second tab. Keep both: the check is the manners, the
  // trigger is the rule.
  const { data: promotion, error: readError } = await untypedFrom(supabase, "lesson_promotions")
    .select("id, retired_at")
    .eq("id", input.promotionId)
    .eq("user_id", userId)
    .maybeSingle()
    .returns<{ id: string; retired_at: string | null } | null>();
  if (readError) return { ok: false, message: GENERIC };
  if (!promotion) {
    return { ok: false, message: "That experiment is no longer there. Reload and see what's still open." };
  }
  if (promotion.retired_at) {
    return { ok: false, message: "You've already given this one its verdict. Reload to see where it landed." };
  }

  const { data, error } = await untypedFrom(supabase, "lesson_verdicts")
    .insert({
      promotion_id: input.promotionId,
      verdict: input.verdict,
      reason: reason || null,
    })
    .select("id")
    .returns<{ id: string }[]>();

  if (error) {
    switch (pgCode(error)) {
      case NOT_IN_PREREQUISITE_STATE:
        // 128's trigger won the race this function's read could not.
        return { ok: false, message: "You've already given this one its verdict. Reload to see where it landed." };
      case CHECK_VIOLATION:
        return { ok: false, message: "Say what didn't work. A month from now that sentence is the whole value." };
      case FK_VIOLATION:
        return { ok: false, message: "That experiment is no longer there. Reload and see what's still open." };
      default:
        return { ok: false, message: GENERIC };
    }
  }
  if (!data?.[0]) {
    return { ok: false, message: "That didn't save. You may have been signed out — reload and try again." };
  }

  revalidatePath("/close");
  revalidatePath("/personal/self_mastery");
  return { ok: true };
}
