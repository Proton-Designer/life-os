"use server";

import { requireUser } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate } from "@/lib/date-utils";
import { revalidatePath } from "next/cache";
import type { PrayerName } from "@/lib/prayer-times/windows";
import type { SunnahSlot } from "@/lib/deen/sunnah";

async function todayForUser(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  return localDateString(new Date(), profile?.timezone ?? "UTC");
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

/**
 * Plain tally insert — no text/note column by design (see design spec: a
 * glance at an expanded note could leak content; a tally count can't).
 */
export async function logReflectionEntry(tier: 1 | 2 | 3): Promise<void> {
  const { supabase, userId } = await requireUser();
  const date = await todayForUser(supabase, userId);

  const { error } = await supabase.from("reflection_entries").insert({
    user_id: userId,
    date,
    tier,
  });
  if (error) throw error;
  revalidatePath("/deen");
}

/**
 * Misclick correction — deletes only the single most recent entry of this
 * tier logged today, never an earlier one. No-ops (not an error) if there's
 * nothing to decrement, since this is a "whoops" affordance, not a data
 * integrity check like toggleKillListItem's not-found case.
 */
export async function decrementReflectionEntry(tier: 1 | 2 | 3): Promise<void> {
  const { supabase, userId } = await requireUser();
  const date = await todayForUser(supabase, userId);

  const { data: mostRecent } = await supabase
    .from("reflection_entries")
    .select("id")
    .eq("user_id", userId)
    .eq("date", date)
    .eq("tier", tier)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!mostRecent) return;

  const { error } = await supabase.from("reflection_entries").delete().eq("id", mostRecent.id);
  if (error) throw error;
  revalidatePath("/deen");
}

// anchorCue is the implementation-intention cue ("After Fajr") — see
// docs/superpowers/specs/2026-08-18-habit-builder-redesign-proposal.md §1.
// Normalized to null (never "") so "no cue set" and "cue cleared" stay
// distinguishable, matching the column's own nullable-no-default design.
export async function createDeenHabit(name: string, anchorCue?: string): Promise<{ id: string }> {
  const { supabase, userId } = await requireUser();
  const committedDate = await todayForUser(supabase, userId);
  const trimmedCue = anchorCue?.trim();

  const { data, error } = await supabase
    .from("deen_habits")
    .insert({
      user_id: userId,
      name,
      committed_date: committedDate,
      anchor_cue: trimmedCue ? trimmedCue : null,
    })
    .select("id")
    .single();
  if (error) throw error;
  revalidatePath("/deen");
  return { id: data.id };
}

export async function toggleDeenHabitLog(habitId: string, date: string): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data: existing } = await supabase
    .from("deen_habit_logs")
    .select("completed")
    .eq("habit_id", habitId)
    .eq("date", date)
    .maybeSingle();

  const { error } = await supabase.from("deen_habit_logs").upsert(
    {
      habit_id: habitId,
      user_id: userId,
      date,
      completed: !existing?.completed,
    },
    { onConflict: "habit_id,date" }
  );
  if (error) throw error;
  revalidatePath("/deen");
  revalidatePath("/");
}

// Same upsert-and-flip shape as toggleDeenHabitLog. Sunnah doesn't appear on
// Home, so only /deen is revalidated.
export async function toggleSunnah(
  date: string,
  prayerName: PrayerName,
  slot: SunnahSlot
): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data: existing } = await supabase
    .from("sunnah_logs")
    .select("completed")
    .eq("user_id", userId)
    .eq("date", date)
    .eq("prayer_name", prayerName)
    .eq("slot", slot)
    .maybeSingle();

  const { error } = await supabase.from("sunnah_logs").upsert(
    {
      user_id: userId,
      date,
      prayer_name: prayerName,
      slot,
      completed: !existing?.completed,
    },
    { onConflict: "user_id,date,prayer_name,slot" }
  );
  if (error) throw error;
  revalidatePath("/deen");
}

/**
 * week_start_date is computed server-side (never trusts a client-passed
 * date) since it drives the (user_id, week_start_date) uniqueness — same
 * discipline as skipCheckinsToday/logQuranSession's self-computed dates.
 */
export async function setWeeklyFocus(habitId: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const today = await todayForUser(supabase, userId);
  const weekStartDate = getWeekStartDate(today);

  const { error } = await supabase.from("deen_weekly_focus").upsert(
    { user_id: userId, week_start_date: weekStartDate, habit_id: habitId },
    { onConflict: "user_id,week_start_date" }
  );
  if (error) throw error;
  revalidatePath("/deen");
}
