"use server";

import { createClient } from "@/lib/supabase/server";
import { localDateString, getWeekStartDate, addDaysToDateString } from "@/lib/date-utils";
import { revalidatePath } from "next/cache";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, userId: user.id };
}

export async function saveWeeklyGoal(
  domain: "deen" | "business",
  headline: string,
  milestones: string[],
  quranPageTarget?: number,
  now: Date = new Date()
): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  const timezone = profile?.timezone ?? "UTC";
  const currentWeekStart = getWeekStartDate(localDateString(now, timezone));
  const previousWeekStart = addDaysToDateString(currentWeekStart, -7);

  const { error: upsertError } = await supabase.from("weekly_goals").upsert(
    {
      user_id: userId,
      week_start_date: currentWeekStart,
      domain,
      headline,
      milestones,
      quran_page_target: quranPageTarget ?? null,
    },
    { onConflict: "user_id,week_start_date,domain" }
  );
  if (upsertError) throw upsertError;

  // Lock the previous week's row the first time this week's is saved, per
  // spec's "past weeks are locked/read-only once the week ends" rule.
  const { data: previousWeek } = await supabase
    .from("weekly_goals")
    .select("id, locked")
    .eq("user_id", userId)
    .eq("week_start_date", previousWeekStart)
    .eq("domain", domain)
    .maybeSingle();

  if (previousWeek && !previousWeek.locked) {
    const { error: lockError } = await supabase
      .from("weekly_goals")
      .update({ locked: true })
      .eq("id", previousWeek.id);
    if (lockError) throw lockError;
  }

  revalidatePath("/weekly-planning");
  revalidatePath("/");
}
