import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * R5 core(supabase, userId, ...) extraction for app/(app)/business/actions.ts
 * — same discipline as lib/deen/actions-core.ts, lib/coop/targets-core.ts,
 * lib/coop/tasks-core.ts. None of these call requireUser()/getProfile()/
 * getAuthedUser().
 */

export async function setKillListItemCore(supabase: SupabaseClient, userId: string, date: string, position: 0 | 1 | 2, text: string): Promise<void> {
  const { error } = await supabase.from("kill_list_items").upsert({ user_id: userId, date, position, text }, { onConflict: "user_id,date,position" });
  if (error) throw error;
}

export interface ToggleKillListItemResult {
  completed: boolean;
}

export async function toggleKillListItemCore(supabase: SupabaseClient, userId: string, id: string): Promise<ToggleKillListItemResult> {
  const { data: existing } = await supabase.from("kill_list_items").select("completed").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!existing) {
    // Row doesn't exist, or isn't this user's (RLS would also block the
    // write below, but fail loud here rather than silently updating 0 rows).
    throw new Error("Kill list item not found");
  }
  const nowCompleted = !existing.completed;
  const { error } = await supabase
    .from("kill_list_items")
    .update({ completed: nowCompleted, completed_at: nowCompleted ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  return { completed: nowCompleted };
}

/** Business domain's weekly-goal save — see saveBusinessWeeklyGoal's own comment (app/(app)/business/actions.ts) on why this is the minimal version, not Task 11.1's real one. */
export async function saveBusinessWeeklyGoalCore(supabase: SupabaseClient, userId: string, weekStartDate: string, headline: string, milestones: string[]): Promise<void> {
  const { error } = await supabase
    .from("weekly_goals")
    .upsert({ user_id: userId, week_start_date: weekStartDate, domain: "business", headline, milestones }, { onConflict: "user_id,week_start_date,domain" });
  if (error) throw error;
}

export interface StartWorkSessionResult {
  id: string;
  startedAt: string;
}

/**
 * "At most one active session per user" is an application-level invariant
 * (not a DB constraint), checked read-then-write — matches the original
 * exactly. Scoped to `counts_toward_hours = true` sessions only (a
 * same-time review session doesn't block starting a focus session).
 */
export async function startWorkSessionCore(supabase: SupabaseClient, userId: string, kind: "deep_work" | "deep_study"): Promise<StartWorkSessionResult> {
  const { data: active } = await supabase.from("work_sessions").select("id").eq("user_id", userId).is("ended_at", null).eq("counts_toward_hours", true).maybeSingle();
  if (active) throw new Error("A work session is already active");

  const { data, error } = await supabase.from("work_sessions").insert({ user_id: userId, kind }).select("id, started_at").single();
  if (error) throw error;
  return { id: data.id, startedAt: data.started_at };
}

export async function endWorkSessionCore(supabase: SupabaseClient, userId: string, sessionId: string): Promise<void> {
  const { data: existing } = await supabase.from("work_sessions").select("id").eq("id", sessionId).eq("user_id", userId).maybeSingle();
  if (!existing) throw new Error("Work session not found");

  const { error } = await supabase.from("work_sessions").update({ ended_at: new Date().toISOString() }).eq("id", sessionId).eq("user_id", userId);
  if (error) throw error;
}
