import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { checkSecret } from "../check-secret";

// Test-only diagnostic (e2e/fitness.spec.ts): a hand-maintained "check these
// three tables" teardown rots the moment the feature grows a table the test
// author didn't remember to add — exactly what happened here (Opus Lead,
// 2026-08-23: workout_schedule/workout_sessions/session_sets were never in
// the original teardown, and a migration 040 is coming that adds another
// reference). This enumerates every table the fitness-plan feature touches,
// read-only, so the spec asserts zero residue against the actual current
// list rather than whatever list existed when a given test was written.
// Same secret-gated shape as the other test-only routes; grants nothing an
// authenticated user couldn't already read about their own rows.
export async function GET(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const userId = user.id;

  type CountableTable =
    | "workout_plans"
    | "plan_sessions"
    | "plan_session_exercises"
    | "plan_micro_exercises"
    | "workout_schedule"
    | "workout_sessions"
    | "session_sets"
    | "fitness_cycle_anchor"
    | "fitness_benchmarks";

  const count = async (table: CountableTable) => {
    const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true }).eq("user_id", userId);
    if (error) throw error;
    return count ?? 0;
  };

  const [
    workoutPlans,
    planSessions,
    planSessionExercises,
    planMicroExercises,
    workoutSchedule,
    workoutSessions,
    sessionSets,
    fitnessCycleAnchor,
    fitnessBenchmarks,
    { data: activeRow },
  ] = await Promise.all([
    count("workout_plans"),
    count("plan_sessions"),
    count("plan_session_exercises"),
    count("plan_micro_exercises"),
    count("workout_schedule"),
    count("workout_sessions"),
    count("session_sets"),
    count("fitness_cycle_anchor"),
    count("fitness_benchmarks"),
    supabase.from("active_workout_plans").select("micro_plan_id, routine_plan_id").eq("user_id", userId).maybeSingle(),
  ]);

  return NextResponse.json({
    workoutPlans,
    planSessions,
    planSessionExercises,
    planMicroExercises,
    workoutSchedule,
    workoutSessions,
    sessionSets,
    fitnessCycleAnchor,
    fitnessBenchmarks,
    activeMicroPlanId: activeRow?.micro_plan_id ?? null,
    activeRoutinePlanId: activeRow?.routine_plan_id ?? null,
  });
}
