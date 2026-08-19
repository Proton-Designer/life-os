"use server";

import { requireUser } from "@/lib/supabase/auth";
import { revalidatePath } from "next/cache";

/**
 * Writes the hourly Lock-In confirm — one checkin_allocations row per
 * confirmed hour, never the legacy point-sample path (that's the whole
 * reason the session ratio used to read "No data": nothing wrote real
 * allocation minutes for an in-progress session).
 *
 * "Yes, still on it" -> business, 60 real minutes. "No" -> wasted, not a
 * guessed noise domain (school/fitness/co_op) — there's no basis to pick
 * one, and "known-not-business, unattributed" is exactly what an honest
 * "not really" answer means. A MISSED hour writes nothing at all — that's
 * deliberate (see lib/checkins/prefill.ts's subtractConfirmedHours doc
 * comment): silence keeps falling back to the pre-existing coarse
 * session-overlap credit, per Ayman's own design ("that entire period will
 * be counted as just signal... it's my job to end a lock-in session before
 * I get distracted") — only an explicit answer overrides it.
 */
export async function confirmSessionHour(sessionId: string, hourStartIso: string, stillOnIt: boolean): Promise<void> {
  const { supabase, userId } = await requireUser();
  const hourStart = new Date(hourStartIso);
  const hourEnd = new Date(hourStart.getTime() + 60 * 60_000);

  const { data: checkin, error: checkinError } = await supabase
    .from("checkins")
    .insert({
      user_id: userId,
      checkin_time: hourEnd.toISOString(),
      kind: "allocation",
      window_start: hourStart.toISOString(),
      window_end: hourEnd.toISOString(),
      answered: true,
      work_session_id: sessionId,
    })
    .select("id")
    .single();
  if (checkinError) throw checkinError;

  const { error: allocationError } = await supabase.from("checkin_allocations").insert({
    checkin_id: checkin.id,
    user_id: userId,
    domain: stillOnIt ? "business" : "wasted",
    minutes: 60,
  });
  if (allocationError) throw allocationError;

  revalidatePath("/business");
  revalidatePath("/");
}
