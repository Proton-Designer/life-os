import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { SessionExercise } from "@/components/fitness/session-detail-panel";

export type PlanSessionDetail = {
  id: string;
  name: string;
  exercises: SessionExercise[];
};

/**
 * The plan-session equivalent of load-workout-details.ts's loadWorkoutDetails
 * — same shape (SessionDetailPanel is reused as-is for confirming a plan
 * session, not just a legacy `workouts` template), same lastTopSet query
 * against session_sets by exercise_id: progression history doesn't care
 * whether a past confirm came from a legacy workout or a plan session, both
 * write the same session_sets rows.
 *
 * plan_session_exercises has no rep-range (targetRepsLow/High) — only a
 * single target_reps — so targetRepsLow/High both collapse to that one
 * value here; SessionDetailPanel's progression math (proposeNextLoad) only
 * reads targetRepsHigh, so this loses nothing behaviourally, just widens
 * the display range to a point.
 */
export async function loadPlanSessionDetails(
  supabase: SupabaseClient<Database>,
  userId: string,
  sessionIds: string[]
): Promise<Map<string, PlanSessionDetail>> {
  const detailsById = new Map<string, PlanSessionDetail>();
  if (sessionIds.length === 0) return detailsById;

  const { data: sessionRows } = await supabase
    .from("plan_sessions")
    .select(
      "id, name, plan_session_exercises(exercise_id, position, duration_minutes, target_sets, target_reps, load_lb, exercises(name))"
    )
    .in("id", sessionIds);

  const exerciseIdsInPlay = Array.from(
    new Set((sessionRows ?? []).flatMap((s) => (s.plan_session_exercises ?? []).map((se) => se.exercise_id)))
  );

  const { data: lastSetRows } =
    exerciseIdsInPlay.length > 0
      ? await supabase
          .from("session_sets")
          .select("exercise_id, sets, reps, load, workout_sessions!inner(date, source, user_id)")
          .eq("workout_sessions.user_id", userId)
          .eq("workout_sessions.source", "confirmed")
          .in("exercise_id", exerciseIdsInPlay)
          .order("workout_sessions(date)", { ascending: false })
      : { data: [] };

  const lastTopSetByExercise = new Map<string, { load: number | null; reps: number }>();
  for (const row of lastSetRows ?? []) {
    if (row.exercise_id && !lastTopSetByExercise.has(row.exercise_id)) {
      lastTopSetByExercise.set(row.exercise_id, { load: row.load, reps: row.reps });
    }
  }

  for (const s of sessionRows ?? []) {
    detailsById.set(s.id, {
      id: s.id,
      name: s.name,
      exercises: (s.plan_session_exercises ?? [])
        .sort((a, b) => a.position - b.position)
        .map((se) => {
          const last = lastTopSetByExercise.get(se.exercise_id) ?? null;
          const targetReps = se.target_reps ?? 1;
          return {
            exerciseId: se.exercise_id,
            name: se.exercises?.name ?? "",
            targetSets: se.target_sets ?? 1,
            targetRepsLow: targetReps,
            targetRepsHigh: targetReps,
            targetLoad: se.load_lb,
            lastTopSet: last ? { load: last.load, reps: last.reps, targetRepsHigh: targetReps } : null,
          };
        }),
    });
  }

  return detailsById;
}
