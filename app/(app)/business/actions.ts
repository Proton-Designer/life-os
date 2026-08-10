"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, userId: user.id };
}

export async function setKillListItem(
  date: string,
  position: 0 | 1 | 2,
  text: string
): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("kill_list_items").upsert(
    { user_id: userId, date, position, text },
    { onConflict: "user_id,date,position" }
  );
  if (error) throw error;
  revalidatePath("/business");
  revalidatePath("/");
}

export async function toggleKillListItem(id: string): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data: existing } = await supabase
    .from("kill_list_items")
    .select("completed")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!existing) {
    // Row doesn't exist, or isn't this user's (RLS would also block the write
    // below, but fail loud here rather than silently updating 0 rows).
    throw new Error("Kill list item not found");
  }

  const { error } = await supabase
    .from("kill_list_items")
    .update({ completed: !existing.completed })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/business");
  revalidatePath("/");
}

// getWeeklySignalNoiseRatio deliberately isn't re-exported from here: a plain
// `export { X } from ...` re-export inside a "use server" file breaks Next's
// server-action manifest generation in dev (Turbopack reports "the module has
// no exports at all" for every real export once a non-function re-export is
// present). It's not a Server Action anyway — import it directly from
// @/lib/business/sn-ratio (this page and Insights, Task 12.1, both do).

/**
 * Minimal weekly-goal save for the Business domain screen — a plain upsert,
 * no locking/carry-forward. Task 11.1 (Weekly Planning) owns the real
 * `saveWeeklyGoal` with that logic and generalizes this card's UI pattern
 * into `components/shared/goal-card.tsx`, per the plan's own note that this
 * component is a precursor to that shared version.
 */
export async function saveBusinessWeeklyGoal(
  weekStartDate: string,
  headline: string,
  milestones: string[]
): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("weekly_goals").upsert(
    {
      user_id: userId,
      week_start_date: weekStartDate,
      domain: "business",
      headline,
      milestones,
    },
    { onConflict: "user_id,week_start_date,domain" }
  );
  if (error) throw error;
  revalidatePath("/business");
}
