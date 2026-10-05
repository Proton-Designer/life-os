"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { setTaskPlannedStartTimeCore } from "@/lib/tasks/actions-core";
import { isValidBedtime } from "@/lib/night-plan/sleep-intent";

/**
 * P2-06 timeboxing — the cookie-authed layer over
 * lib/tasks/actions-core.ts#setTaskPlannedStartTimeCore, same split every
 * other feature in this codebase uses: requireUser() lives here, the real
 * mutation there (unit-testable independent of Next's request context).
 *
 * Format validation reuses `isValidBedtime` (lib/night-plan/sleep-intent.ts)
 * rather than a second copy of the same "HH:MM 24h" regex — the DB's own
 * CHECK constraint (migration 192) is defense in depth, not the primary
 * guard, same posture P2-05 established for sleep_intents.
 */
export async function setTaskPlannedStartTime(taskId: string, time: string): Promise<{ ok: boolean; message: string }> {
  if (!isValidBedtime(time)) {
    return { ok: false, message: "Enter a valid time, e.g. 9:30 AM." };
  }
  const { supabase, userId } = await requireUser();
  try {
    await setTaskPlannedStartTimeCore(supabase, userId, taskId, time);
  } catch {
    return { ok: false, message: "Couldn't save that start time. Try again." };
  }
  // IA-P2: the timebox editor lives on Home's Today strip now; /open/today only redirects.
  revalidatePath("/");
  return { ok: true, message: "Saved." };
}

export async function clearTaskPlannedStartTime(taskId: string): Promise<{ ok: boolean; message: string }> {
  const { supabase, userId } = await requireUser();
  try {
    await setTaskPlannedStartTimeCore(supabase, userId, taskId, null);
  } catch {
    return { ok: false, message: "Couldn't clear that start time. Try again." };
  }
  // IA-P2: the timebox editor lives on Home's Today strip now; /open/today only redirects.
  revalidatePath("/");
  return { ok: true, message: "Cleared." };
}
