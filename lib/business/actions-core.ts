import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toggleTaskCore } from "@/lib/tasks/actions-core";

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

/** One selected objective, as the setup dialog collected it (146) — the
 * caller-facing shape; `startWorkSessionCore` maps each to a
 * `work_session_objectives` row keyed by `position` (array order = selection
 * order, per the dialog's own contract). */
export type StartSessionObjectiveInput =
  | { kind: "kill_list_item"; killListItemId: string }
  | { kind: "task"; taskId: string }
  | { kind: "custom"; customText: string };

export type StartWorkSessionInput = {
  kind: "deep_work" | "deep_study";
  /** Optional/nullable so callers with no goal concept — today, the MCP
   * `work_session.start` tool (lib/mcp/write-registry.ts), which has no
   * setup dialog to collect one — can still start a plain session. Renders
   * in the overlay exactly as a pre-146 session did (Opus Lead's explicit
   * backward-compatibility requirement): no `/ goal`, no progress bar, no
   * auto-end. */
  goalMinutes?: number | null;
  classId?: string | null;
  objectives?: StartSessionObjectiveInput[];
};

/**
 * "At most one active session per user" is an application-level invariant
 * (not a DB constraint), checked read-then-write — matches the original
 * exactly. Scoped to `counts_toward_hours = true` sessions only (a
 * same-time review session doesn't block starting a focus session).
 *
 * THE SESSION AND ITS OBJECTIVES ARE ONE ACTION, WITH CLEANUP ON FAILURE
 * (146/Phase 3) — same pattern as `addClassAssessmentCore`
 * (lib/school/actions-core.ts): Postgres/PostgREST has no shared transaction
 * across these two `.insert()` calls, so if the objectives insert fails
 * after the session already committed, the session row is deleted rather
 * than left behind. A session carrying a goal but missing the objectives it
 * was supposed to have is worse than no session at all — it would render as
 * a real Lock-In session with a silently empty checklist.
 */
export async function startWorkSessionCore(
  supabase: SupabaseClient,
  userId: string,
  input: StartWorkSessionInput
): Promise<StartWorkSessionResult> {
  const { data: active } = await supabase.from("work_sessions").select("id").eq("user_id", userId).is("ended_at", null).eq("counts_toward_hours", true).maybeSingle();
  if (active) throw new Error("A work session is already active");

  const { data: session, error: sessionError } = await supabase
    .from("work_sessions")
    .insert({ user_id: userId, kind: input.kind, goal_minutes: input.goalMinutes ?? null, class_id: input.classId ?? null })
    .select("id, started_at")
    .single();
  if (sessionError) throw sessionError;

  const objectives = input.objectives ?? [];
  if (objectives.length > 0) {
    const rows = objectives.map((objective, position) => ({
      user_id: userId,
      session_id: session.id,
      position,
      kind: objective.kind,
      kill_list_item_id: objective.kind === "kill_list_item" ? objective.killListItemId : null,
      task_id: objective.kind === "task" ? objective.taskId : null,
      custom_text: objective.kind === "custom" ? objective.customText : null,
    }));
    const { error: objectivesError } = await supabase.from("work_session_objectives").insert(rows);
    if (objectivesError) {
      await supabase.from("work_sessions").delete().eq("id", session.id).eq("user_id", userId);
      throw objectivesError;
    }
  }

  return { id: session.id, startedAt: session.started_at };
}

/**
 * `endedAtIso`, when given, is the AUTO-END TIMESTAMP RULE's value
 * (lib/business/session-goal.ts's `goalEndsAtIso` for a goal-reached
 * auto-end — `started_at + goal_minutes`, never the wall-clock moment the
 * app noticed) or an explicit `now()` for an objectives-complete auto-end.
 * Omitted entirely for a manual "End Session" tap, where the wall clock IS
 * the honest moment. Never the caller's job to write `work_sessions.updated_at`
 * here or anywhere else on this table — migration 146's
 * `work_sessions_touch_updated_at` trigger owns that column exclusively as
 * of this UPDATE; a manual write would be a second source of truth for the
 * exact value the trigger exists to guarantee.
 */
export async function endWorkSessionCore(supabase: SupabaseClient, userId: string, sessionId: string, endedAtIso?: string): Promise<void> {
  const { data: existing } = await supabase.from("work_sessions").select("id").eq("id", sessionId).eq("user_id", userId).maybeSingle();
  if (!existing) throw new Error("Work session not found");

  const { error } = await supabase.from("work_sessions").update({ ended_at: endedAtIso ?? new Date().toISOString() }).eq("id", sessionId).eq("user_id", userId);
  if (error) throw error;
}

/**
 * Toggles one session objective — DERIVE, NOT MIRROR (146/Phase 3, agreed
 * with the Opus Lead after the original spec's "write-through and mirror"
 * proposal was found to desync: `toggleKillListItem`/`toggleTask` are
 * already callable independent of any session, from /business, Home, and
 * School, so a `completed` copy on this table would only stay correct if
 * EVERY write path updated it, which none of the others do or should have
 * to know about).
 *
 * kind='kill_list_item'/'task': calls the EXISTING toggle (same table, same
 * function the non-session UI already uses) and returns — this table's own
 * `completed` column is never written for these two kinds. The caller reads
 * completion by joining to the live row (lib/business/session-objectives.ts),
 * never from here.
 *
 * kind='custom': there is no external row to derive from, so this table's
 * `completed` genuinely IS the source of truth, and this is the one case
 * that writes it directly.
 */
export async function toggleSessionObjectiveCore(supabase: SupabaseClient, userId: string, objectiveId: string): Promise<void> {
  const { data: objective, error: fetchError } = await supabase
    .from("work_session_objectives")
    .select("id, kind, kill_list_item_id, task_id, completed")
    .eq("id", objectiveId)
    .eq("user_id", userId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!objective) throw new Error("Session objective not found");

  if (objective.kind === "kill_list_item") {
    if (!objective.kill_list_item_id) throw new Error("kill_list_item objective is missing its reference");
    await toggleKillListItemCore(supabase, userId, objective.kill_list_item_id);
    return;
  }
  if (objective.kind === "task") {
    if (!objective.task_id) throw new Error("task objective is missing its reference");
    await toggleTaskCore(supabase, userId, objective.task_id);
    return;
  }

  const nowCompleted = !objective.completed;
  const { error } = await supabase
    .from("work_session_objectives")
    .update({ completed: nowCompleted, completed_at: nowCompleted ? new Date().toISOString() : null })
    .eq("id", objectiveId)
    .eq("user_id", userId);
  if (error) throw error;
}
