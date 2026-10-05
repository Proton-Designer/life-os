"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { getFocusTargetSettingsCore, saveFocusTargetsCore } from "@/lib/focus/target-core";
import type { FocusTargetSettings } from "@/lib/focus/target";

/** The daily focus target (HOME-01a). Not gated by an opt-in: every account has the Hours strip. */
export async function getFocusTargetSettings(): Promise<FocusTargetSettings> {
  const { supabase, userId } = await requireUser();
  return getFocusTargetSettingsCore(supabase, userId);
}

/** Absolute values in minutes; null clears (daily null = default 4 h, weekend null = same as daily). */
export async function saveFocusTargets(input: FocusTargetSettings): Promise<{ ok: true } | { ok: false; message: string }> {
  const { supabase, userId } = await requireUser();
  try {
    await saveFocusTargetsCore(supabase, userId, input);
    revalidatePath("/");
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string } | null)?.message;
    return { ok: false, message: message ?? "Couldn't save your focus target." };
  }
}
