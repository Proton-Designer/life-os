import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Verdict } from "./types";

/**
 * R5 `core(supabase, userId, ...)` extraction for the loop seam's verdict
 * write (`lesson_verdicts`) — the MCP write path's "adopt/abandon a
 * promoted lesson." Reuses migration 128's own DB-enforced guard
 * (`reject_verdict_on_retired_promotion`, fires BEFORE INSERT) as THE
 * guarantee that a retired promotion takes no further verdicts; this
 * function's own promotion lookup is manners, not the guarantee — moved
 * here verbatim from `lib/promotions/actions.ts`'s original `recordVerdict`,
 * not reimplemented.
 *
 * THROWS on any failure, with a message a human or a model can act on —
 * the shared contract every other MCP-reachable core() in this program
 * follows (lib/deen/actions-core.ts, etc.), NOT the `ActionResult` shape
 * `lib/promotions/actions.ts`'s cookie-authed `recordVerdict` presents to
 * its own UI. That Server Action now wraps this core and translates a
 * thrown error back into `{ok:false, message}` to preserve its existing
 * contract for its own callers — see that file's own comment.
 *
 * `lesson_promotions`/`lesson_verdicts` ARE in the generated `Database`
 * type today (confirmed directly against lib/supabase/database.types.ts)
 * — `lib/self-mastery/untyped-from.ts`'s header claiming otherwise is
 * stale as of this file; a real `SupabaseClient<Database>` is used here
 * rather than that escape hatch.
 */

const GENERIC = "Something went wrong. Nothing was saved — please try again.";
const FK_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
/**
 * 55000 object_not_in_prerequisite_state — raised by migration 128's
 * trigger when a verdict is submitted on an already-retired promotion.
 * Deliberately not check_violation: this table already maps
 * check_violation to the abandoned-needs-a-reason CHECK, and two refusals
 * sharing one code means one of them answers the caller's question wrongly.
 */
const NOT_IN_PREREQUISITE_STATE = "55000";
const UNIQUE_VIOLATION = "23505";

function pgCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

export interface PromoteLessonInput {
  lessonId: string;
  acceptedText: string;
  areaId: string;
}

export interface PromotedLesson {
  promotionId: string;
}

/**
 * P4-08: R5 extraction of `lib/promotions/actions.ts`'s original
 * `promoteLesson` body, moved here VERBATIM (same pg-error-code mapping,
 * same messages) so the MCP write path reaches identical logic with zero
 * duplication — same split `recordVerdictCore` already established in
 * this file. THROWS (this file's own convention), unlike the original
 * function's `ActionResult` return; `promoteLesson` itself becomes a thin
 * wrapper translating a thrown error back to `{ok:false, message}`, same
 * pattern `recordVerdict` already uses below.
 *
 * Uses the TYPED client (`SupabaseClient<Database>`), not the original's
 * `untypedFrom` escape hatch — `lesson_promotions` IS in the generated
 * `Database` type (confirmed directly against database.types.ts before
 * writing this), so `lib/self-mastery/untyped-from.ts`'s own header
 * claiming otherwise is stale for this table specifically. Not fixing the
 * original `promoteLesson`'s own use of it here (out of this function's
 * scope) — only this new core avoids it.
 */
export async function promoteLessonCore(supabase: SupabaseClient<Database>, userId: string, input: PromoteLessonInput): Promise<PromotedLesson> {
  const acceptedText = input.acceptedText.trim();

  if (!acceptedText) {
    throw new Error("Write what you're actually going to do — even one line.");
  }
  if (!input.areaId) {
    throw new Error("Choose which area of your life this belongs to.");
  }

  const { data, error } = await supabase
    .from("lesson_promotions")
    .insert({
      // user_id is set by trigger from the caller, never from client input
      // (set_user_id_from_caller). Sending it would be ignored at best --
      // still supplied for real here (not a dummy) since it's already known.
      user_id: userId,
      lesson_id: input.lessonId,
      area_id: input.areaId,
      accepted_text: acceptedText,
    })
    .select("id")
    .single();

  if (error) {
    switch (pgCode(error)) {
      case UNIQUE_VIOLATION:
        // lesson_promotions_active_per_lesson. Not an error the user caused
        // twice — usually a second tab, or a back-button resubmit.
        throw new Error("You're already testing this lesson. Give the current run its verdict first.");
      case FK_VIOLATION:
        throw new Error("That area is no longer available. Pick another one.");
      case CHECK_VIOLATION:
        throw new Error("Write what you're actually going to do — even one line.");
      default:
        throw new Error(GENERIC);
    }
  }
  if (!data) {
    throw new Error("That didn't save. You may have been signed out — reload and try again.");
  }

  return { promotionId: data.id };
}

export interface RecordVerdictInput {
  promotionId: string;
  verdict: Verdict;
  /** Required (and validated, both here AND by the DB's own `lesson_verdicts_abandoned_needs_reason` CHECK) when verdict is 'abandoned'. Ignored otherwise. */
  reason?: string | null;
}

export interface RecordedVerdict {
  id: string;
  promotionId: string;
  verdict: Verdict;
  /** `lesson_verdicts.verdict_at` — this table's real, immutable "when" (see lib/mcp/registry.ts's `lesson_verdict` entity for why it's a faithful updatedAtColumn: the table is append-only, enforced by trigger). */
  verdictAt: string;
}

export async function recordVerdictCore(supabase: SupabaseClient<Database>, userId: string, input: RecordVerdictInput): Promise<RecordedVerdict> {
  const reason = (input.reason ?? "").trim();

  // `lesson_verdicts_abandoned_needs_reason` enforces this at the DB too;
  // this sentence is what a caller actually sees before ever reaching it.
  if (input.verdict === "abandoned" && !reason) {
    throw new Error("Say what didn't work. A month from now that sentence is the whole value.");
  }

  // GUARD: a retired promotion takes no further verdicts.
  //
  // THIS READ IS NOT THE GUARANTEE — migration 128's BEFORE INSERT trigger
  // is, and it is caught below as 55000. This check exists to give the
  // common case (a promotion already given its verdict, or from a caller
  // who forgot) a clear message and a cheap exit instead of a database
  // exception. A read-then-write can still lose a race with a concurrent
  // call; the trigger is what actually can't be bypassed.
  const { data: promotion, error: readError } = await supabase
    .from("lesson_promotions")
    .select("id, retired_at")
    .eq("id", input.promotionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw new Error(GENERIC);
  if (!promotion) {
    throw new Error("That experiment is no longer there. Reload and see what's still open.");
  }
  if (promotion.retired_at) {
    throw new Error("You've already given this one its verdict. Reload to see where it landed.");
  }

  const { data, error } = await supabase
    .from("lesson_verdicts")
    .insert({
      // user_id is overwritten unconditionally by lesson_verdicts_set_user_id
      // (124) regardless of what's passed — supplied for real here (not a
      // dummy) since it's already known, but never trusted as the source of
      // truth for ownership.
      user_id: userId,
      promotion_id: input.promotionId,
      verdict: input.verdict,
      reason: reason || null,
    })
    .select("id, verdict_at")
    .single();

  if (error) {
    switch (pgCode(error)) {
      case NOT_IN_PREREQUISITE_STATE:
        // 128's trigger won the race this function's own read could not.
        throw new Error("You've already given this one its verdict. Reload to see where it landed.");
      case CHECK_VIOLATION:
        throw new Error("Say what didn't work. A month from now that sentence is the whole value.");
      case FK_VIOLATION:
        throw new Error("That experiment is no longer there. Reload and see what's still open.");
      default:
        throw new Error(GENERIC);
    }
  }
  if (!data) throw new Error("That didn't save. You may have been signed out — reload and try again.");

  return { id: data.id, promotionId: input.promotionId, verdict: input.verdict, verdictAt: data.verdict_at };
}
