import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

/**
 * The workout_schedule shim (docs/superpowers/plans/2026-08-22-fitness-system.md,
 * "Compatibility shim — read this first"). `workout_schedule` has nine
 * readers outside fitness (Home, check-ins, notifications) — abandoning it
 * breaks all three. This is the ONE function that re-derives it from the
 * active routine plan; call it from every mutation path that touches an
 * active routine plan's sessions (savePlan, deletePlan, activatePlan,
 * deactivateSlot). Never duplicate this logic inline in an action.
 *
 * Full re-derivation every call — delete every existing row for the user,
 * then reinsert from the active routine plan's sessions, same
 * delete-then-reinsert discipline as save_workout (031). This also means
 * activating a routine plan supersedes any legacy per-day assignment made
 * through the old assignWorkoutToDay/setWorkoutSchedule actions — the
 * table becomes a pure derived projection of the active plan from that
 * point on, which is the intended behaviour, not a regression: those
 * legacy actions predate plans existing as a first-class concept.
 *
 * `workout_schedule` has a `unique (user_id, day_of_week)` constraint — one
 * row per day. When two sessions' schedule_days both cover the same day
 * (deliberately allowed — an AM/PM split), the lowest-`position` session
 * wins that day's row. This is a best-effort mirror for the nine legacy
 * readers, not a lossless one; This Week (Phase 3) is the real
 * uncollapsed view for that case.
 */
export async function syncWorkoutScheduleForActiveRoutine(supabase: TypedClient, userId: string): Promise<void> {
  const { data: active, error: activeError } = await supabase
    .from("active_workout_plans")
    .select("routine_plan_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (activeError) throw activeError;

  const { error: deleteError } = await supabase.from("workout_schedule").delete().eq("user_id", userId);
  if (deleteError) throw deleteError;

  const routinePlanId = active?.routine_plan_id ?? null;
  if (!routinePlanId) return;

  const { data: sessions, error: sessionsError } = await supabase
    .from("plan_sessions")
    .select("name, position, schedule_days, start_time, plan_session_exercises(duration_minutes)")
    .eq("plan_id", routinePlanId)
    .order("position");
  if (sessionsError) throw sessionsError;

  const rowByDay = new Map<
    number,
    { user_id: string; day_of_week: number; workout_id: null; workout_name: string; time: string | null; duration_minutes: number | null }
  >();

  for (const session of sessions ?? []) {
    if (rowByDay.size > 0 && (session.schedule_days ?? []).every((d) => rowByDay.has(d))) continue;
    const durationMinutes = (session.plan_session_exercises ?? []).reduce(
      (sum, e) => sum + (Number.isFinite(e.duration_minutes) ? e.duration_minutes : 0),
      0
    );
    for (const day of session.schedule_days ?? []) {
      if (rowByDay.has(day)) continue;
      rowByDay.set(day, {
        user_id: userId,
        day_of_week: day,
        workout_id: null,
        workout_name: session.name,
        time: session.start_time,
        duration_minutes: durationMinutes > 0 ? durationMinutes : null,
      });
    }
  }

  if (rowByDay.size === 0) return;
  const { error: insertError } = await supabase.from("workout_schedule").insert(Array.from(rowByDay.values()));
  if (insertError) throw insertError;
}
