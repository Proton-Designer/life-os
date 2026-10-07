"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { isDeenModeOnForRequest, DEEN_MODE_OFF_MESSAGE } from "@/lib/deen/deen-mode-guard";
import { saveQuranReminderWindowCore } from "@/lib/quran/reminder-core";

/**
 * The Quran reminder window (Package D): when today's Quran portion shows on Home. Deen-gated server-side (OFF = refused,
 * data untouched: a Server Action is a public POST endpoint, hiding the control is not refusing). Validates "HH:MM" and
 * refuses start == end with a clear message, then revalidates Home and Settings.
 */
export async function saveQuranReminderWindow(input: { start: string; end: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const { supabase, userId } = await requireUser();
  if (!(await isDeenModeOnForRequest())) return { ok: false, message: DEEN_MODE_OFF_MESSAGE };
  try {
    await saveQuranReminderWindowCore(supabase, userId, input);
    revalidatePath("/");
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string } | null)?.message;
    return { ok: false, message: message ?? "Couldn't save your Quran reminder times." };
  }
}
