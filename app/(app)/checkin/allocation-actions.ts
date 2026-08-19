"use server";

import { requireUser } from "@/lib/supabase/auth";
import { revalidatePath } from "next/cache";
import { getPendingAllocationQueue } from "@/lib/checkins/get-allocation-queue";
import { wastedMinutes, type Allocation } from "@/lib/checkins/allocation";

/**
 * Saves one allocation check-in via the save_allocation_checkin RPC
 * (020_save_allocation_checkin_fn.sql), which writes the checkins parent row
 * and every checkin_allocations child row (including the derived `wasted`
 * row) as one atomic call. Bound per-window with .bind(null, windowStart,
 * windowEnd) before being handed to the Client Component as `onSave` — a
 * bound Server Action reference survives the server/client boundary; a
 * wrapping arrow function does not (AGENTS.md).
 */
export async function saveAllocationCheckin(
  windowStart: string,
  windowEnd: string,
  allocation: Allocation
): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("save_allocation_checkin", {
    p_window_start: windowStart,
    p_window_end: windowEnd,
    p_allocations: { ...allocation, wasted: wastedMinutes(allocation) },
  });
  if (error) throw error;
  revalidatePath("/");
}

/** Client-callable wrapper — the AppShell gate polls this rather than calling the server-only getPendingAllocationQueue directly. */
export async function getAllocationQueueForNow(nowIso: string) {
  const { userId } = await requireUser();
  return getPendingAllocationQueue(userId, new Date(nowIso));
}
