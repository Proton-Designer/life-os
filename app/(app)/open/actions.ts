"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { markDayStarted } from "@/lib/day-structure/day-start";

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
