"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { setMorningBriefCollapsedCore } from "@/lib/morning-brief/collapsed-core";

/**
 * HOME-01a: minimize / expand the morning brief. An ABSOLUTE setter (collapsed true/false, never a toggle) for the
 * brief_date shown, user-scoped. The card flips its own state optimistically, but the write MUST also drop
 * the cached Home: Home's Router Cache lives 30 minutes (next.config staleTimes.dynamic), and a cached payload
 * still carries the old `initialCollapsed`, so without this a minimized brief pops back open on the next visit.
 * It is a once-a-day tap, so the re-render cost is fine. Revalidated only after the write succeeded.
 */
export async function setMorningBriefCollapsed(briefDate: string, collapsed: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  const { supabase, userId } = await requireUser();
  try {
    await setMorningBriefCollapsedCore(supabase, userId, briefDate, collapsed);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string } | null)?.message;
    return { ok: false, message: message ?? "Couldn't save that." };
  }
}
