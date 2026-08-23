"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { syncWorkoutScheduleForActiveRoutine } from "@/lib/fitness/sync-workout-schedule";
import type { PlanDraft, PlanKind } from "@/lib/fitness/plan-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Plan CRUD — the four server actions Engineer B's builder calls, exact
 * signatures from docs/superpowers/plans/2026-08-22-fitness-system.md
 * "Type contract, part 2." Every one of these re-syncs workout_schedule
 * (lib/fitness/sync-workout-schedule.ts) unconditionally rather than
 * trying to detect "did this touch the active routine plan" — the sync
 * function itself is cheap (reads the active slot, re-derives) and
 * unconditional calls are how "never miss a path" actually gets enforced,
 * per the plan's own warning about this shim being the single highest-risk
 * item in the build.
 *
 * savePlan does a full delete-and-reinsert of the plan's children on every
 * save, matching save_workout's (031) pattern — not wrapped in a single
 * DB transaction (no RPC here, several sequential calls instead), which
 * carries the same accepted trade-off createWorkoutWithExercises already
 * documents: a failure mid-save leaves an incomplete-but-valid state the
 * user can just re-save, not a corrupted one, since nothing here can
 * produce a row referencing a nonexistent parent.
 */

type TypedClient = SupabaseClient<Database>;

async function requireOwnedPlan(supabase: TypedClient, userId: string, planId: string, kind: PlanKind) {
  const { data, error } = await supabase
    .from("workout_plans")
    .select("id, kind")
    .eq("id", planId)
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  if (data.kind !== kind) throw new Error(`Plan ${planId} is kind ${data.kind}, not ${kind}`);
}

function revalidateFitness() {
  revalidatePath("/fitness/workouts");
  revalidatePath("/fitness");
  revalidatePath("/");
}

export async function savePlan(draft: PlanDraft): Promise<{ id: string }> {
  const { supabase, userId } = await requireUser();

  let planId = draft.id;
  if (planId === null) {
    const { data, error } = await supabase
      .from("workout_plans")
      .insert({ user_id: userId, name: draft.name, kind: draft.kind })
      .select("id")
      .single();
    if (error) throw error;
    planId = data.id;
  } else {
    await requireOwnedPlan(supabase, userId, planId, draft.kind);
    const { error } = await supabase
      .from("workout_plans")
      .update({ name: draft.name })
      .eq("id", planId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  if (draft.kind === "micro") {
    const { error: deleteError } = await supabase.from("plan_micro_exercises").delete().eq("plan_id", planId);
    if (deleteError) throw deleteError;

    const rows = draft.exercises.map((ex, i) => ({
      user_id: userId,
      plan_id: planId as string,
      exercise_id: ex.exerciseId,
      position: i + 1,
      schedule_days: ex.scheduleDays,
      goal_type: ex.goalType,
      goal_value: ex.goalValue,
      notes: ex.notes,
    }));
    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("plan_micro_exercises").insert(rows);
      if (insertError) throw insertError;
    }
  } else {
    // Each session needs a stable backing `workouts` row (040) so
    // workout_schedule.workout_id / workout_sessions.workout_id have
    // something real to match against — two Home readers require that
    // non-null match to register "workout done," and a null workout_id is
    // otherwise silently dead for completion (2026-08-23 review catch).
    // Matched by session id, not name (a rename must not orphan the row or
    // alias two sessions onto one), so existing sessions' workout_ids are
    // read BEFORE the delete-then-reinsert below wipes plan_sessions.
    const { data: oldSessionRows, error: oldSessionsError } = await supabase
      .from("plan_sessions")
      .select("id, workout_id")
      .eq("plan_id", planId);
    if (oldSessionsError) throw oldSessionsError;
    const workoutIdByOldSessionId = new Map((oldSessionRows ?? []).map((s) => [s.id, s.workout_id]));

    const keptSessionIds = new Set(draft.sessions.map((s) => s.id).filter((id): id is string => id !== null));
    const orphanedWorkoutIds = (oldSessionRows ?? [])
      .filter((s) => !keptSessionIds.has(s.id) && s.workout_id !== null)
      .map((s) => s.workout_id as string);
    if (orphanedWorkoutIds.length > 0) {
      const { error: archiveError } = await supabase
        .from("workouts")
        .update({ archived: true })
        .in("id", orphanedWorkoutIds)
        .eq("user_id", userId);
      if (archiveError) throw archiveError;
    }

    // Cascades to plan_session_exercises via ON DELETE CASCADE (036).
    const { error: deleteError } = await supabase.from("plan_sessions").delete().eq("plan_id", planId);
    if (deleteError) throw deleteError;

    for (let i = 0; i < draft.sessions.length; i++) {
      const session = draft.sessions[i];

      let workoutId = session.id ? (workoutIdByOldSessionId.get(session.id) ?? null) : null;
      if (workoutId === null) {
        const { data: workoutRow, error: workoutError } = await supabase
          .from("workouts")
          .insert({ user_id: userId, name: session.name })
          .select("id")
          .single();
        if (workoutError) throw workoutError;
        workoutId = workoutRow.id;
      }

      const { data: sessionRow, error: sessionError } = await supabase
        .from("plan_sessions")
        .insert({
          user_id: userId,
          plan_id: planId,
          name: session.name,
          position: i + 1,
          schedule_days: session.scheduleDays,
          start_time: session.startTime,
          workout_id: workoutId,
        })
        .select("id")
        .single();
      if (sessionError) throw sessionError;

      const exerciseRows = session.exercises.map((ex, j) => ({
        user_id: userId,
        session_id: sessionRow.id,
        exercise_id: ex.exerciseId,
        position: j + 1,
        duration_minutes: ex.durationMinutes,
        load_lb: ex.loadLb,
        target_sets: ex.targetSets,
        target_reps: ex.targetReps,
      }));
      if (exerciseRows.length > 0) {
        const { error: exercisesError } = await supabase.from("plan_session_exercises").insert(exerciseRows);
        if (exercisesError) throw exercisesError;
      }
    }
  }

  // clearIfInactive: this draft's own routine plan, if it isn't currently
  // active, has never contributed rows to workout_schedule — nothing to
  // clear. If it IS active, routinePlanId is non-null inside the sync
  // function and the full-rederive branch fires regardless of this flag.
  await syncWorkoutScheduleForActiveRoutine(supabase, userId, { clearIfInactive: draft.kind === "routine" });
  revalidateFitness();
  return { id: planId };
}

export async function deletePlan(planId: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { data: activeBefore, error: activeError } = await supabase
    .from("active_workout_plans")
    .select("routine_plan_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (activeError) throw activeError;
  const wasActiveRoutine = activeBefore?.routine_plan_id === planId;

  // Archive every session's backing workouts row (040) before the cascade
  // deletes plan_sessions — deleting a whole plan deletes all its
  // sessions, same "deleting a session archives its row" rule as savePlan.
  const { data: sessionsToArchive, error: sessionsError } = await supabase
    .from("plan_sessions")
    .select("workout_id")
    .eq("plan_id", planId)
    .not("workout_id", "is", null);
  if (sessionsError) throw sessionsError;
  const workoutIdsToArchive = (sessionsToArchive ?? []).map((s) => s.workout_id as string);
  if (workoutIdsToArchive.length > 0) {
    const { error: archiveError } = await supabase
      .from("workouts")
      .update({ archived: true })
      .in("id", workoutIdsToArchive)
      .eq("user_id", userId);
    if (archiveError) throw archiveError;
  }

  // ON DELETE SET NULL (037) clears whichever slot held this plan.
  const { error } = await supabase.from("workout_plans").delete().eq("id", planId).eq("user_id", userId);
  if (error) throw error;
  await syncWorkoutScheduleForActiveRoutine(supabase, userId, { clearIfInactive: wasActiveRoutine });
  revalidateFitness();
}

async function setActiveSlot(supabase: TypedClient, userId: string, kind: PlanKind, planId: string | null) {
  const { data: existing, error: existingError } = await supabase
    .from("active_workout_plans")
    .select("micro_plan_id, routine_plan_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) throw existingError;

  const microPlanId = kind === "micro" ? planId : (existing?.micro_plan_id ?? null);
  const routinePlanId = kind === "routine" ? planId : (existing?.routine_plan_id ?? null);

  const { error } = await supabase
    .from("active_workout_plans")
    .upsert(
      { user_id: userId, micro_plan_id: microPlanId, routine_plan_id: routinePlanId, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) throw error;
}

export async function activatePlan(planId: string, kind: PlanKind): Promise<void> {
  const { supabase, userId } = await requireUser();
  await requireOwnedPlan(supabase, userId, planId, kind);
  await setActiveSlot(supabase, userId, kind, planId);
  await syncWorkoutScheduleForActiveRoutine(supabase, userId, { clearIfInactive: kind === "routine" });
  revalidateFitness();
}

export async function deactivateSlot(kind: PlanKind): Promise<void> {
  const { supabase, userId } = await requireUser();
  await setActiveSlot(supabase, userId, kind, null);
  await syncWorkoutScheduleForActiveRoutine(supabase, userId, { clearIfInactive: kind === "routine" });
  revalidateFitness();
}
