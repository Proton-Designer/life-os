"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { markWorryHandledCore, reopenWorryCore, recordWorryOutcomeCore, type WorryOutcome, type WorryCoreResult } from "@/lib/night-plan/worries";

const WORRY_OUTCOMES: readonly WorryOutcome[] = ["resolved", "took_action", "let_go"];

/**
 * The Worry List's writes. THIN WRAPPERS over lib/night-plan/worries.ts's
 * cores (P4-07) — the MCP write tool calls the same cores (markWorryHandled/
 * reopenWorry only; recordWorryOutcome is not in P4-07's scope). See that
 * file for the "SET not toggle" / "existence checked first" / "dump_source
 * predicate as defense in depth" reasoning.
 */

function revalidateWorrySurfaces() {
  revalidatePath("/worries");
  revalidatePath("/week");
  revalidatePath("/close");
  revalidatePath("/open");
  revalidatePath("/");
}

/** This file's own return shape (`{ok:true}|{error:string}`) predates the core's `{ok:true}|{ok:false,error}` (P4-07) -- kept exactly as-is here so existing callers (which check `"error" in result`) see no change. */
function toLegacyResult(result: WorryCoreResult): { ok: true } | { error: string } {
  return result.ok ? { ok: true } : { error: result.error };
}

export async function markWorryHandled(id: string): Promise<{ ok: true } | { error: string }> {
  const { supabase, userId } = await requireUser();
  const result = await markWorryHandledCore(supabase, userId, id);
  if (result.ok) revalidateWorrySurfaces();
  return toLegacyResult(result);
}

/**
 * P2-12 — the Monday Anti-Worry Hour's one write: mark a worry handled AND
 * record HOW (migration 201's `worry_outcome`), in one round trip rather
 * than a plain `markWorryHandled` plus a second update — a worry marked
 * handled with no outcome yet (even for a moment) would be a real,
 * observable inconsistent state for anything reading both fields.
 *
 * THIN WRAPPER over recordWorryOutcomeCore (lib/night-plan/worries.ts) — the
 * outcome value is validated against the fixed set here (not in the core,
 * which has no opinion on the UI's own vocabulary) before ever reaching it:
 * a malformed value reads as "could not be found"-shaped input rejection,
 * not a raw constraint-violation error string.
 */
export async function recordWorryOutcome(id: string, outcome: WorryOutcome): Promise<{ ok: true } | { error: string }> {
  if (!WORRY_OUTCOMES.includes(outcome)) return { error: "Unknown outcome." };

  const { supabase, userId } = await requireUser();
  const result = await recordWorryOutcomeCore(supabase, userId, id, outcome);
  if (result.ok) revalidateWorrySurfaces();
  return toLegacyResult(result);
}

export async function reopenWorry(id: string): Promise<{ ok: true } | { error: string }> {
  const { supabase, userId } = await requireUser();
  const result = await reopenWorryCore(supabase, userId, id);
  if (result.ok) revalidateWorrySurfaces();
  return toLegacyResult(result);
}
