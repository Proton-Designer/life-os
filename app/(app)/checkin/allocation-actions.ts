"use server";

import { requireUser } from "@/lib/supabase/auth";
import { revalidatePath } from "next/cache";
import { getPendingAllocationQueue } from "@/lib/checkins/get-allocation-queue";
import { wastedMinutes, type Allocation } from "@/lib/checkins/allocation";

/**
 * Saves one allocation check-in via the save_allocation_checkin RPC
 * (020_save_allocation_checkin_fn.sql, made idempotent in
 * 022_save_allocation_checkin_idempotent.sql), which writes the checkins
 * parent row and every checkin_allocations child row (including the
 * derived `wasted` row) as one atomic call. A second call for the same
 * (user, window_start) — reload mid-save, two tabs, a client retry after a
 * timeout where the write actually landed — is impossible to double-write
 * at the database level (021_checkins_one_allocation_per_window.sql's
 * partial unique index) and the RPC itself treats hitting it as success,
 * returning the already-recorded checkin id rather than throwing; verified
 * live via psql impersonation (two calls, one row, first write's values
 * preserved). Called directly from client code (imported and invoked, not
 * received as a prop from a Server Component) — see allocation-checkin-
 * gate.tsx's own header for why that side-steps the function-prop RSC
 * boundary in AGENTS.md.
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
