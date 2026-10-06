import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toggleTaskCore, setTaskCompletedCore } from "@/lib/tasks/actions-core";
import { syncPlanTaskFromKillList } from "@/lib/plan/pair-sync";

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
  await syncPlanTaskFromKillList(supabase, userId, id, nowCompleted, nowCompleted ? new Date().toISOString() : null);
  return { completed: nowCompleted };
}

/**
 * SETS (not toggles) a kill-list item's completion -- the optimistic UI sends its
 * intended value so an ordered queue stays "last tap wins" even after a failed write
 * (PERF-2; same reasoning as setAdhkarCore).
 */
export async function setKillListItemCompletedCore(supabase: SupabaseClient, userId: string, id: string, completed: boolean): Promise<ToggleKillListItemResult> {
  const { data, error } = await supabase
    .from("kill_list_items")
    .update({ completed, completed_at: completed ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Kill list item not found");
  await syncPlanTaskFromKillList(supabase, userId, id, completed, completed ? new Date().toISOString() : null);
  return { completed };
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
 * #37: whether an objective actually NAMES a deliverable. `kill_list_item`
 * and `task` objectives always do — they reference a real, already-titled
 * row, so requiring typed text on TOP of a real selection would be
 * re-asking a question the selection already answered (Opus Lead's ruling
 * condition 4). Only a `custom` objective's free-form text can be blank,
 * so that is the one kind this actually checks.
 */
function objectiveNamesADeliverable(objective: StartSessionObjectiveInput): boolean {
  if (objective.kind === "custom") return objective.customText.trim().length > 0;
  return true;
}

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
 *
 * #37 (Opus Lead's ruling, 2026-09-14): "can't start without typing what
 * you'll produce" is enforced HERE, not only in session-setup-dialog.tsx's
 * `canStart` — a disabled button alone is a hidden-button contract; the
 * scarcity a caller can't route around is the one the server itself
 * refuses, same posture as the 5-goal ceiling being an index rather than a
 * form that only draws five rows (migration 165). This is a THROWN
 * validation error, matching this file's own and every other core()
 * file's convention for a rejected input (see distraction's captureCore,
 * goals' createGoal) — not a change to this function's success return
 * shape, which every existing caller (the setup dialog's `onStart`,
 * lib/mcp/write-registry.ts's `work_session.start` handler) already
 * expects to either resolve or throw.
 *
 * APPLIES TO EVERY CALLER, deliberately, including the MCP `work_session.
 * start` tool (lib/mcp/write-registry.ts) — enumerated via `git grep
 * startWorkSessionCore` per this function's own existing cross-track-
 * interface warning below. That tool's handler now supplies a `deliverable`
 * patch field mapped to a single `custom` objective so it keeps working
 * (see write-registry.ts's own comment on that change).
 *
 * NO BACKFILL, NO NOT NULL: this only gates a NEW session's objectives
 * array at start time. A historical session with zero objectives (every
 * session started before this ruling) is untouched and renders exactly as
 * it does today everywhere it's read.
 */
export async function startWorkSessionCore(
  supabase: SupabaseClient,
  userId: string,
  input: StartWorkSessionInput | StartWorkSessionInput["kind"]
): Promise<StartWorkSessionResult> {
  // Accepts the bare kind as well as the full input object. This is a
  // CROSS-TRACK COMPATIBILITY SHIM, not a convenience: `core()` functions in
  // this repo are called from files owned by different tracks, and 146's
  // Phase 3 widened this third parameter while `lib/mcp/write-registry.ts`
  // (the AI Integration program's `work_session.start` tool, a third call
  // site neither track had enumerated) still passed a bare string. That
  // broke `main` for BOTH tracks -- the fix belonged in a file this track
  // must not commit, because it also carried another track's unfinished
  // work. Widening here unblocks it without either track touching the
  // other's file, and stays correct after they land `{ kind }`.
  //
  // The real lesson, and the reason this comment is long: a shared core()
  // signature is a cross-track interface. `git grep` the function name
  // across the WHOLE repo before changing one, not just the tree you own --
  // the file boundary that keeps tracks out of each other's work is exactly
  // what hides the call sites you don't expect.
  const normalized: StartWorkSessionInput = typeof input === "string" ? { kind: input } : input;

  // #37's gate — checked before the active-session read below (a bad
  // input is rejected without a wasted round trip either way, but this
  // ordering also means a caller learns "you didn't name a deliverable"
  // rather than "a session is already active" when both happen to be true).
  const objectives = normalized.objectives ?? [];
  if (!objectives.some(objectiveNamesADeliverable)) {
    throw new Error("A Lock-In session needs at least one objective — name what you'll produce before starting.");
  }

  const { data: active } = await supabase.from("work_sessions").select("id").eq("user_id", userId).is("ended_at", null).eq("counts_toward_hours", true).maybeSingle();
  if (active) throw new Error("A work session is already active");

  const { data: session, error: sessionError } = await supabase
    .from("work_sessions")
    .insert({ user_id: userId, kind: normalized.kind, goal_minutes: normalized.goalMinutes ?? null, class_id: normalized.classId ?? null })
    .select("id, started_at")
    .single();
  if (sessionError) throw sessionError;

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
 *
 * IDEMPOTENCY (AI Integration program, MCP `work.work_session.end` — see
 * lib/mcp/write-registry.ts): `ended_at` is what focus-time totals and
 * Signal:Noise are computed from, so a retry that silently re-stamps it is
 * not a harmless no-op, it's a corrupted total. A no-op guard, mirroring
 * `confirm_workout_session`'s "already done -> return, don't re-do" shape:
 * if the session is already ended, this is a retry of a call that already
 * succeeded — return without writing. The `.is("ended_at", null)` on the
 * UPDATE itself (not just the earlier SELECT) closes the read-then-write
 * race a plain existence check would leave open: two truly concurrent
 * retries can both pass the SELECT, but at most one WHERE `ended_at is
 * null` UPDATE can match a row whose `ended_at` the other just set.
 */
export async function endWorkSessionCore(supabase: SupabaseClient, userId: string, sessionId: string, endedAtIso?: string): Promise<void> {
  const { data: existing } = await supabase.from("work_sessions").select("id, ended_at").eq("id", sessionId).eq("user_id", userId).maybeSingle();
  if (!existing) throw new Error("Work session not found");
  if (existing.ended_at !== null) return; // already ended -- idempotent no-op, never re-stamp forward

  const { error } = await supabase
    .from("work_sessions")
    .update({ ended_at: endedAtIso ?? new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .is("ended_at", null);
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

/**
 * SETS (not toggles) one session objective's completion -- the Lock-In overlay sends its
 * intended value so an ordered queue stays "last tap wins" even after a failed write
 * (PERF-4; same reasoning as setAdhkarCore). Same derive-not-mirror rule as
 * toggleSessionObjectiveCore: kill-list and task objectives write the live row, only
 * kind='custom' writes this table's own `completed`.
 */
export async function setSessionObjectiveCompletedCore(supabase: SupabaseClient, userId: string, objectiveId: string, completed: boolean): Promise<void> {
  const { data: objective, error: fetchError } = await supabase
    .from("work_session_objectives")
    .select("id, kind, kill_list_item_id, task_id")
    .eq("id", objectiveId)
    .eq("user_id", userId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!objective) throw new Error("Session objective not found");

  if (objective.kind === "kill_list_item") {
    if (!objective.kill_list_item_id) throw new Error("kill_list_item objective is missing its reference");
    await setKillListItemCompletedCore(supabase, userId, objective.kill_list_item_id, completed);
    return;
  }
  if (objective.kind === "task") {
    if (!objective.task_id) throw new Error("task objective is missing its reference");
    await setTaskCompletedCore(supabase, userId, objective.task_id, completed);
    return;
  }

  const { error } = await supabase
    .from("work_session_objectives")
    .update({ completed, completed_at: completed ? new Date().toISOString() : null })
    .eq("id", objectiveId)
    .eq("user_id", userId);
  if (error) throw error;
}
