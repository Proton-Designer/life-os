"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { getTodayDayStart, markDayStarted, resolveWakeInstant } from "@/lib/day-structure/day-start";

/**
 * The Start Day tap (#33) -- the morning's one write, called from Home's Morning card
 * (components/home/rhythm/start-day-button.tsx). IDEMPOTENT: `day_starts` is unique on
 * (user_id, local_date) (lib/day-structure/day-start.ts markDayStarted), so tapping twice on the
 * same local day never creates a second mark and never moves the first one's `woke_at`.
 * IA-P2: no redirect any more (it used to land on /open/today); revalidating "/" re-renders Home
 * with the Today strip. Unauthenticated -> /login, nothing written.
 */
export async function startDayAction(): Promise<void> {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const supabase = await createClient();

  await markDayStarted(supabase, user.id, timezone, new Date());
  // IA-P2: Start Day lives on Home now (the Morning card -> Today strip); /open and /open/today
  // are redirects. No redirect here: the card flips to "started" at once and Home re-renders.
  revalidatePath("/");
}

export type StartDayAtResult = { ok: true; alreadyStarted: boolean } | { ok: false; message: string };

/**
 * "I woke earlier than I'm tapping": starts the day with a wake time of day (local "HH:MM") instead of now. The wake mark
 * is IMMOVABLE once it exists (migration 153: no update policy; Delta/Efficiency derive from it), so this is only ever the
 * FIRST mark -- if the day was already started it changes nothing and says so. A future time is refused. Returned, not
 * thrown, so the reason reaches the user (Next masks a Server Action's thrown message in production).
 */
export async function startDayAtAction(wakeTime: string): Promise<StartDayAtResult> {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const now = new Date();
  const resolved = resolveWakeInstant(wakeTime, timezone, now);
  if (!resolved.ok) return resolved;

  const supabase = await createClient();
  const before = await getTodayDayStart(supabase, user.id, timezone, now);
  await markDayStarted(supabase, user.id, timezone, now, resolved.at);
  revalidatePath("/");
  return { ok: true, alreadyStarted: before !== null };
}

