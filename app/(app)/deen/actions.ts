"use server";

import { createClient } from "@/lib/supabase/server";
import { localDateString } from "@/lib/date-utils";
import { revalidatePath } from "next/cache";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, userId: user.id };
}

export async function markPrayer(
  date: string,
  prayerName: "fajr" | "dhuhr" | "asr" | "maghrib" | "isha",
  status: "on_time" | "qada" | "missed"
): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("prayers").upsert(
    {
      user_id: userId,
      date,
      prayer_name: prayerName,
      status,
      logged_at: new Date().toISOString(),
    },
    { onConflict: "user_id,date,prayer_name" }
  );
  if (error) throw error;
  revalidatePath("/deen");
  revalidatePath("/");
}

export async function toggleAdhkar(date: string, period: "morning" | "evening"): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data: existing } = await supabase
    .from("adhkar_logs")
    .select("completed")
    .eq("user_id", userId)
    .eq("date", date)
    .eq("period", period)
    .maybeSingle();

  const { error } = await supabase.from("adhkar_logs").upsert(
    {
      user_id: userId,
      date,
      period,
      completed: !existing?.completed,
    },
    { onConflict: "user_id,date,period" }
  );
  if (error) throw error;
  revalidatePath("/deen");
  revalidatePath("/");
}

export async function logQuranSession(
  pages: number,
  surah?: string,
  juz?: number
): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  const date = localDateString(new Date(), profile?.timezone ?? "UTC");

  const { error } = await supabase.from("quran_sessions").insert({
    user_id: userId,
    date,
    pages_read: pages,
    surah: surah ?? null,
    juz: juz ?? null,
  });
  if (error) throw error;
  revalidatePath("/deen");
}

export async function adjustQadaBacklog(delta: number): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("qada_owed")
    .eq("user_id", userId)
    .maybeSingle();

  const next = Math.max(0, (profile?.qada_owed ?? 0) + delta);

  const { error } = await supabase
    .from("profiles")
    .update({ qada_owed: next })
    .eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/deen");
}

export async function setTravelingMode(enabled: boolean): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { error } = await supabase
    .from("profiles")
    .update({ traveling_mode: enabled })
    .eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/deen");
}
