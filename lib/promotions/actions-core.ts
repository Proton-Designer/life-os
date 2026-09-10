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

function pgCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
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
