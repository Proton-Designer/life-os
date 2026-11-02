"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { getSelfMasterySettingsCore, saveSelfMasterySettingsCore } from "@/lib/self-mastery/session-settings-core";
import { setSelfMasteryOnHomeCore } from "@/lib/self-mastery/home-visibility-core";
import { validateSelfMasterySettings, type SelfMasterySessionSettings } from "@/lib/self-mastery/session-settings";

/** New cards per day and the daily session length. Shown only to accounts that have Self-Mastery (the Settings page decides). */
export async function getSelfMasterySettings(): Promise<SelfMasterySessionSettings> {
  const { supabase, userId } = await requireUser();
  return getSelfMasterySettingsCore(supabase, userId);
}

export async function saveSelfMasterySettings(input: SelfMasterySessionSettings): Promise<{ ok: true } | { ok: false; message: string }> {
  // Validated here too, before anything is read or written: this is a public server action, not just the form's backend.
  const invalid = validateSelfMasterySettings(input);
  if (invalid) return { ok: false, message: invalid };
  const { supabase, userId } = await requireUser();
  try {
    await saveSelfMasterySettingsCore(supabase, userId, input);
    revalidatePath("/"); // Home's Self-Mastery card is computed from these
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string } | null)?.message;
    return { ok: false, message: message ?? "Couldn't save your Self-Mastery settings." };
  }
}

/** The master switch for Self-Mastery on Home (default on). Off hides the session card, "Continue reading" and the book-loading banner. */
export async function setSelfMasteryOnHome(onHome: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  if (typeof onHome !== "boolean") return { ok: false, message: "Show Self-Mastery on Home must be true or false." };
  const { supabase, userId } = await requireUser();
  try {
    await setSelfMasteryOnHomeCore(supabase, userId, onHome);
    revalidatePath("/");
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string } | null)?.message;
    return { ok: false, message: message ?? "Couldn't save that setting." };
  }
}
