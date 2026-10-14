import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planTaskIdForSessionCore, unbankSecondsCore } from "@/lib/night-plan/plan-work-core";
import { checkCorrectedLength } from "@/lib/business/session-correction";

export type CorrectSessionResult = { ok: true; endedAtIso: string } | { ok: false; message: string };

/**
 * Shortens an ENDED Deep Work / Deep Study session to its real length (a session left running overnight). Only `ended_at`
 * moves, so every total derived from the row (hours, Signal:Noise, the day ribbon) follows; the time that ending the session
 * banked into its plan line is taken back by the same amount. Only ever shorter, never a running or someone else's session.
 */
export async function correctSessionLengthCore(supabase: SupabaseClient, userId: string, sessionId: string, minutes: number): Promise<CorrectSessionResult> {
  const { data: row, error } = await supabase
    .from("work_sessions")
    .select("id, started_at, ended_at, counts_toward_hours")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return { ok: false, message: "Couldn't find that session." };
  if (!row.ended_at) return { ok: false, message: "That session is still running. End it first, then fix its length." };
  if (!row.counts_toward_hours) return { ok: false, message: "Only Deep Work and Deep Study sessions can be fixed here." };

  const check = checkCorrectedLength(row.started_at as string, row.ended_at as string, minutes);
  if (!check.ok) return check;

  const oldSeconds = Math.round((new Date(row.ended_at as string).getTime() - new Date(row.started_at as string).getTime()) / 1000);
  const { data: updated, error: updateError } = await supabase
    .from("work_sessions")
    .update({ ended_at: check.endedAtIso })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("ended_at", row.ended_at as string) // a concurrent fix/resume loses instead of double-adjusting
    .select("id");
  if (updateError) throw updateError;
  if (!updated || updated.length === 0) return { ok: false, message: "That session changed. Refresh and try again." };

  const taskId = await planTaskIdForSessionCore(supabase, userId, sessionId);
  if (taskId) await unbankSecondsCore(supabase, userId, taskId, oldSeconds - check.newSeconds);
  return { ok: true, endedAtIso: check.endedAtIso };
}
