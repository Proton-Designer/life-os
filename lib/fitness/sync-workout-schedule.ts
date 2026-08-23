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
 *
 * `clearIfInactive` (2026-08-22 review catch, the Lead): when there is NO
 * active routine plan, this function does nothing UNLESS the caller passes
 * `clearIfInactive: true` — meaning the mutation that just happened
 * genuinely concerned the routine slot (activatePlan/deactivateSlot with
 * kind "routine", or deletePlan of whatever plan WAS the active routine
 * before the delete). Without that guard, a micro-plan save calling this
 * unconditionally would delete every workout_schedule row for the user
 * with nothing to reinsert — silently wiping legacy per-day assignments
 * (still live via assignWorkoutToDay until Phase 3 replaces the Sessions
 * panel) that have nothing to do with the plan being saved. The
 * unconditional-call-from-every-action principle stays; the destructive
 * branch is now conditional instead.
 *
 * Not transactional (delete-then-insert, two round trips): a failure
 * between them leaves workout_schedule genuinely empty until the next
 * successful sync, and that failure mode is invisible rather than loud —
 * "Home shows no workout today" with no error anywhere is what a broken
 * sync looks like from the outside. Same accepted trade-off as
 * save_workout/createWorkoutWithExercises, documented here because an
 * empty result gives no clue where to look.
 */
export async function syncWorkoutScheduleForActiveRoutine(
  supabase: TypedClient,
  userId: string,
  options: { clearIfInactive?: boolean } = {}
): Promise<void> {
  const { data: active, error: activeError } = await supabase
    .from("active_workout_plans")
    .select("routine_plan_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (activeError) throw activeError;

  const routinePlanId = active?.routine_plan_id ?? null;

  if (!routinePlanId) {
    if (options.clearIfInactive) {
      const { error: deleteError } = await supabase.from("workout_schedule").delete().eq("user_id", userId);
      if (deleteError) throw deleteError;
    }
    return;
  }

  const { error: deleteError } = await supabase.from("workout_schedule").delete().eq("user_id", userId);
  if (deleteError) throw deleteError;

  const { data: sessions, error: sessionsError } = await supabase
    .from("plan_sessions")
    .select("name, position, schedule_days, start_time, workout_id, plan_session_exercises(duration_minutes)")
    .eq("plan_id", routinePlanId)
    .order("position");
  if (sessionsError) throw sessionsError;

  const rowByDay = new Map<
    number,
    { user_id: string; day_of_week: number; workout_id: string | null; workout_name: string; time: string | null; duration_minutes: number | null }
  >();

  for (const session of sessions ?? []) {
    if (rowByDay.size > 0 && (session.schedule_days ?? []).every((d) => rowByDay.has(d))) continue;
    const durationMinutes = (session.plan_session_exercises ?? []).reduce(
      (sum, e) => sum + (Number.isFinite(e.duration_minutes) ? e.duration_minutes : 0),
      0
    );
    for (const day of session.schedule_days ?? []) {
      if (rowByDay.has(day)) continue;
      // workout_id (040): the legacy mirror two Home readers key completion
      // off (get-domain-snapshots.ts's workoutDone, get-domain-pulse.ts's
      // hasScheduledWorkout both require it non-null AND matching
      // workout_sessions.workout_id, not just present) — plan_session_id
      // stays the source of truth for new code, this is purely so the old
      // readers still light up correctly.
      rowByDay.set(day, {
        user_id: userId,
        day_of_week: day,
        workout_id: session.workout_id,
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
