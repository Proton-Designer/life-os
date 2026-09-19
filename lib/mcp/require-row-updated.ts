import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ToolNotFoundError } from "./tool-input-error";

/**
 * P4-34's shared fix: a caller-id-scoped UPDATE that reports success even
 * when it matched zero rows -- a bad, stale, or cross-tenant id gets a
 * truthful `{id, updated_at}` back with nothing actually changed. ENG-A's
 * triage (2026-09-19) found 16 MCP write actions with this shape; this is
 * the "prefer one shared helper over 40 hand-written checks" fix
 * (acceptance criterion 5) so the next write action inherits the fix
 * instead of re-earning the bug.
 *
 * THE ENUMERATION-SAFETY PROPERTY THIS EXISTS TO PRESERVE (acceptance
 * criterion 2, the subtlest requirement in the spec): the existence check
 * is NOT a second, separately-scoped query. It is the exact SAME
 * `.update(patch).eq("id", id).eq("user_id", userId)` call every one of
 * these actions already needed to run, with `.select("id")` chained onto
 * it so Postgrest returns the affected row instead of nothing. A
 * cross-tenant id and a truly nonexistent id both fail to match this SAME
 * user_id-scoped query, so they produce byte-identical zero-row results
 * and therefore a byte-identical thrown message. There is no way for this
 * helper to leak "belongs to someone else" vs. "doesn't exist" because it
 * never asks a second, differently-scoped question — see ENG-A's own
 * finding that every one of the 32 already-protected actions shares this
 * exact property, and the explicit warning that a helper which queries
 * WITHOUT the tenancy scope converts a truthfulness bug into an
 * id-enumeration vulnerability, which is strictly worse than P4-34 itself.
 *
 * Every CALLER is responsible for actually scoping `patch`/`id`/`userId`
 * correctly (this helper trusts the arguments it's handed — it adds no
 * scoping of its own beyond the fixed `id`/`user_id` column names below).
 * `notFoundMessage` is the caller's own text: per `ToolNotFoundError`'s own
 * safety property (tool-input-error.ts), it may only ever contain the
 * caller's own submitted id and a public-facing entity name — never this
 * function's `table` argument, which is an internal identifier only.
 *
 * NOT a fit for every one of the 16 -- two of ENG-A's triaged cases need
 * their own handling instead (see their own core functions' comments):
 * `confirmPlanSessionCore` is an INSERT, not an UPDATE, so the existence
 * check has to run BEFORE the insert, not wrap an update that doesn't
 * exist yet; `retractHabitVoteCore` is a DELETE against a DIFFERENT table
 * than the one whose existence actually needs checking (the habit, not the
 * vote), so a zero-row delete result is legitimately ambiguous between
 * "no such habit" and "nothing to retract today" and needs a real
 * existence read against the right table first, not this helper.
 */
export async function requireRowUpdated(
  supabase: SupabaseClient,
  table: string,
  patch: Record<string, unknown>,
  id: string,
  userId: string,
  notFoundMessage: string
): Promise<void> {
  const { data, error } = await supabase.from(table).update(patch).eq("id", id).eq("user_id", userId).select("id");
  if (error) throw error;
  if (!data || (Array.isArray(data) && data.length === 0)) {
    throw new ToolNotFoundError(notFoundMessage);
  }
}
