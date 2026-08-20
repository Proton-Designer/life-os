"use server";

import { requireUser } from "@/lib/supabase/auth";
import { revalidatePath } from "next/cache";

/**
 * Sets (or overwrites) one hourly Lock-In hour's status — one
 * checkin_allocations row per hour, never the legacy point-sample path.
 * Replaces the original confirmSessionHour (2026-08-19): that only ever
 * wrote the CURRENT due slot on a Yes/No tap; this generalizes to ANY
 * hour, live or after the session's ended, so the missed-hour ruling's
 * edit affordance (docs/superpowers/specs/2026-08-19-missed-lockin-hours.md,
 * rule 3 — "every hour is editable, during the session and after it ends")
 * has one real write path instead of a special-cased second one.
 *
 * "business" = still on it / confirmed signal, 60 real minutes. "wasted" =
 * not really / confirmed noise, not a guessed domain (school/fitness/
 * co_op) — there's no basis to pick one, and "known-not-business,
 * unattributed" is exactly what an honest "not really" (or an edited
 * missed hour) means.
 *
 * A hour left UNTOUCHED (never called for) writes nothing and instead
 * DERIVES to wasted at read time once superseded — see
 * lib/checkins/session-hour-status.ts's resolveSessionHours. That's the
 * other half of the ruling: auto-missed-as-noise closes the "ignore every
 * prompt" loophole without a background writer ever creating a row he
 * didn't create himself.
 *
 * Delegates the actual write to `upsert_session_hour` (024_upsert_session_hour_fn.sql,
 * Engineer 1) — a DB-level upsert keyed on (user_id, window_start) so
 * calling this twice for the same hour (e.g. correcting an edit) updates
 * the existing row in place, including flipping its domain, rather than
 * leaving a stale duplicate behind.
 */
export async function setSessionHourStatus(
  sessionId: string,
  hourStartIso: string,
  status: "business" | "wasted"
): Promise<void> {
  const { supabase } = await requireUser();
  const hourStart = new Date(hourStartIso);
  const hourEnd = new Date(hourStart.getTime() + 60 * 60_000);

  const { error } = await supabase.rpc("upsert_session_hour", {
    p_session_id: sessionId,
    p_window_start: hourStart.toISOString(),
    p_window_end: hourEnd.toISOString(),
    p_domain: status,
  });
  if (error) throw error;

  revalidatePath("/business");
  revalidatePath("/");
}
