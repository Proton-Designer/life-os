"use server";

import { requireUser } from "@/lib/supabase/auth";
import { setMorningBriefCollapsedCore } from "@/lib/morning-brief/collapsed-core";

/**
 * HOME-01a: minimize / expand the morning brief. An ABSOLUTE setter (collapsed true/false, never a toggle) for the
 * brief_date shown, user-scoped. Lean on purpose: no revalidatePath, because the card flips its own state
 * optimistically and a minimize tap must not queue a whole-page refresh behind it.
 */
export async function setMorningBriefCollapsed(briefDate: string, collapsed: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  const { supabase, userId } = await requireUser();
  try {
    await setMorningBriefCollapsedCore(supabase, userId, briefDate, collapsed);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string } | null)?.message;
    return { ok: false, message: message ?? "Couldn't save that." };
  }
}
