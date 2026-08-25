"use server";

import { requireUser } from "@/lib/supabase/auth";
import { revalidatePath } from "next/cache";

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

  const nowCompleted = !existing.completed;
  const { error } = await supabase
    .from("kill_list_items")
    .update({ completed: nowCompleted, completed_at: nowCompleted ? new Date().toISOString() : null })
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

/**
 * "At most one active session per user" is an application-level invariant
 * (enforced here, not a DB constraint — simplest correct approach for a
 * single-user app, per the design spec). Checked with a read-then-write
 * rather than a DB unique partial index, matching this codebase's existing
 * fail-loud-in-the-action style (see toggleKillListItem).
 *
 * The guard is deliberately kind-agnostic — you cannot be doing deep work
 * and deep study at once, so it checks for ANY active session regardless of
 * kind, not just a same-kind one.
 */
export async function startWorkSession(
  kind: "deep_work" | "deep_study"
): Promise<{ id: string; startedAt: string }> {
  const { supabase, userId } = await requireUser();

  const { data: active } = await supabase
    .from("work_sessions")
    .select("id")
    .eq("user_id", userId)
    .is("ended_at", null)
    .maybeSingle();

  if (active) {
    throw new Error("A work session is already active");
  }

  const { data, error } = await supabase
    .from("work_sessions")
    .insert({ user_id: userId, kind })
    .select("id, started_at")
    .single();
  if (error) throw error;

  revalidatePath("/business");
  revalidatePath("/");
  return { id: data.id, startedAt: data.started_at };
}

export async function endWorkSession(sessionId: string): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data: existing } = await supabase
    .from("work_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!existing) {
    throw new Error("Work session not found");
  }

  const { error } = await supabase
    .from("work_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId);
  if (error) throw error;

  revalidatePath("/business");
  revalidatePath("/");
}
