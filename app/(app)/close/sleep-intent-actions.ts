"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { isValidBedtime } from "@/lib/night-plan/sleep-intent";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `sleep_intents` isn't in generated database.types.ts yet (migration 183
 * not applied at the time this file was written) -- same local escape
 * hatch lib/ai/preferences.ts established (see that file's own header).
 * Delete once types regenerate.
 */
function untypedFrom(supabase: SupabaseClient, table: string) {
  return (supabase as unknown as { from: (t: string) => ReturnType<SupabaseClient["from"]> }).from(table);
}

async function todayLocalDateString(): Promise<string> {
  const profile = await getProfile();
  return localDateString(new Date(), profile?.timezone ?? "UTC");
}

/** Reads today's sleep intent, or null if none has been set (or it was cleared) -- both a genuinely-not-set night and a read error degrade to null, since this is a display-only, best-effort read (same posture as lib/ai/morning-brief.ts's getMorningBriefForToday). */
export async function getMySleepIntentForToday(): Promise<string | null> {
  const { supabase, userId } = await requireUser();
  const todayStr = await todayLocalDateString();
  const { data, error } = await untypedFrom(supabase, "sleep_intents")
    .select("intended_bedtime")
    .eq("user_id", userId)
    .eq("intent_date", todayStr)
    .maybeSingle()
    .returns<{ intended_bedtime: string } | null>();
  if (error || !data) return null;
  return data.intended_bedtime;
}

export async function saveMySleepIntent(time: string): Promise<{ ok: boolean; message: string }> {
  if (!isValidBedtime(time)) {
    return { ok: false, message: "Enter a time as HH:MM (24-hour), e.g. 22:30." };
  }
  const { supabase, userId } = await requireUser();
  const todayStr = await todayLocalDateString();
  const { error } = await untypedFrom(supabase, "sleep_intents").upsert(
    { user_id: userId, intent_date: todayStr, intended_bedtime: time, updated_at: new Date().toISOString() },
    { onConflict: "user_id,intent_date" },
  );
  if (error) return { ok: false, message: "Couldn't save tonight's sleep intent. Try again." };
  revalidatePath("/");
  return { ok: true, message: "Saved." };
}

export async function clearMySleepIntent(): Promise<{ ok: boolean; message: string }> {
  const { supabase, userId } = await requireUser();
  const todayStr = await todayLocalDateString();
  const { error } = await untypedFrom(supabase, "sleep_intents").delete().eq("user_id", userId).eq("intent_date", todayStr);
  if (error) return { ok: false, message: "Couldn't clear tonight's sleep intent. Try again." };
  revalidatePath("/");
  return { ok: true, message: "Cleared." };
}
