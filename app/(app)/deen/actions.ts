"use server";

import { requireUser } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate } from "@/lib/date-utils";
import { revalidatePath } from "next/cache";
import type { PrayerName } from "@/lib/prayer-times/windows";
import type { SunnahSlot } from "@/lib/deen/sunnah";
import type { HabitStage } from "@/lib/deen/habit-stage";

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

/**
 * Corrects a misclick — deletes the stored row entirely rather than writing
 * a new status, so `effectivePrayerStatus` (prayer-status.ts) falls back to
 * deriving pending/upcoming/missed from the prayer window again, exactly as
 * if nothing had ever been logged. Every consumer (streaks, qada backlog,
 * consistency grid, Home's priority feed) reads the same `prayers` rows, so
 * this one delete is enough to un-ripple everywhere — no separate cleanup.
 */
export async function unmarkPrayer(
  date: string,
  prayerName: "fajr" | "dhuhr" | "asr" | "maghrib" | "isha"
): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("prayers")
    .delete()
    .eq("user_id", userId)
    .eq("date", date)
    .eq("prayer_name", prayerName);
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

// --- Habit Builder editor (2026-08-25/26, item 6 data layer — Opus Lead
// contract). C owns the two-screen dialog UI on top of these; these six
// actions are the entire server-side surface it calls into. ------------

/** Same trim-to-null normalization as createDeenHabit — never store "". */
export async function updateDeenHabit(habitId: string, name: string, anchorCue: string | null): Promise<void> {
  const { supabase, userId } = await requireUser();
  const trimmedCue = anchorCue?.trim();

  const { error } = await supabase
    .from("deen_habits")
    .update({ name, anchor_cue: trimmedCue ? trimmedCue : null })
    .eq("id", habitId)
    .eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/deen");
}

/**
 * Soft delete via the existing `archived` column — NEVER a hard delete.
 * deen_habit_logs rows are left in place (ON DELETE CASCADE only applies
 * to an actual row delete, which this deliberately never does), so an
 * archived habit's history survives if it's ever un-archived later.
 */
export async function archiveDeenHabit(habitId: string): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { error } = await supabase
    .from("deen_habits")
    .update({ archived: true })
    .eq("id", habitId)
    .eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/deen");
}

/** `stage` of null resets to automatic (derived from committed_date) — see lib/deen/habit-stage.ts. */
export async function setDeenHabitStageOverride(habitId: string, stage: HabitStage | null): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { error } = await supabase
    .from("deen_habits")
    .update({ stage_override: stage })
    .eq("id", habitId)
    .eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/deen");
}

/**
 * Rejected server-side, not just in the UI's form (AGENTS.md, and this
 * exact class — deriving "today" wrong, or trusting the client for it —
 * has shipped three times). `committedDate` floors habit-streak.ts's and
 * habit-consistency.ts's own date ranges, so a future value here would
 * silently produce a negative-length window downstream, not just a
 * cosmetic wrong date.
 */
export async function setDeenHabitCommittedDate(habitId: string, committedDate: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const today = await todayForUser(supabase, userId);
  if (committedDate > today) throw new Error("committedDate cannot be after today");

  const { error } = await supabase
    .from("deen_habits")
    .update({ committed_date: committedDate })
    .eq("id", habitId)
    .eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/deen");
}

/**
 * Sets (not toggles) a specific day's log status — Ayman explicitly asked
 * to "edit status on that habit manually even if it wasnt recorded."
 * deen_habit_logs has NO row at all for a day nobody logged, so this is an
 * upsert on the (habit_id, date) unique constraint
 * (deen_habit_logs_habit_id_date_key, confirmed live pre-migration —
 * migration 047 added no new constraint here because one already existed),
 * not a conditional insert-or-update — an unconditional upsert is correct
 * and can't produce a duplicate row.
 *
 * Future dates rejected server-side, same reasoning as
 * setDeenHabitCommittedDate — habit-streak.ts's walk-back and
 * habit-consistency.ts's rolling-rate window both stop at "yesterday" plus
 * today handled specially; a future log row would sit outside every range
 * either of them actually reads, silently doing nothing useful while still
 * representing corrupt data.
 */
export async function setDeenHabitLogStatus(habitId: string, date: string, completed: boolean): Promise<void> {
  const { supabase, userId } = await requireUser();
  const today = await todayForUser(supabase, userId);
  if (date > today) throw new Error("date cannot be after today");

  const { error } = await supabase
    .from("deen_habit_logs")
    .upsert({ habit_id: habitId, user_id: userId, date, completed }, { onConflict: "habit_id,date" });
  if (error) throw error;
  revalidatePath("/deen");
}

/**
 * Read path for the editor's past-day grid — C reads this to render which
 * days in range are already logged before offering the manual toggle.
 * Only rows that exist are returned (a day with no log row is simply
 * absent, not a `completed: false` row) — same "absence means unlogged,
 * not false" distinction toggleDeenHabitLog's own read implicitly relies
 * on elsewhere in this file.
 */
export async function getDeenHabitLogRange(
  habitId: string,
  startDate: string,
  endDate: string
): Promise<{ date: string; completed: boolean }[]> {
  const { supabase, userId } = await requireUser();

  const { data, error } = await supabase
    .from("deen_habit_logs")
    .select("date, completed")
    .eq("habit_id", habitId)
    .eq("user_id", userId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
