import { describe, expect, it, vi } from "vitest";
import { syncWorkoutScheduleForActiveRoutine } from "../sync-workout-schedule";

function makeChain(responses: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "delete", "insert"]) {
    chain[method] = vi.fn(() => chain);
  }
  const resolved = { data: responses.data ?? null, error: responses.error ?? null };
  chain.maybeSingle = vi.fn(async () => resolved);
  chain.then = (resolve: (v: typeof resolved) => void) => resolve(resolved);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

function makeSupabase(tableResponses: Record<string, { data: unknown; error: unknown }>) {
  const chainsByTable: Record<string, ReturnType<typeof makeChain>> = {};
  const from = vi.fn((table: string) => {
    if (!chainsByTable[table]) chainsByTable[table] = makeChain(tableResponses[table] ?? {});
    return chainsByTable[table];
  });
  return { supabase: { from } as unknown as Parameters<typeof syncWorkoutScheduleForActiveRoutine>[0], chainsByTable };
}

describe("syncWorkoutScheduleForActiveRoutine — duration_minutes constraint", () => {
  it("rounds a non-multiple-of-15 sum to the nearest 15 rather than violating the DB check constraint (2026-08-23 review catch: this 500'd activatePlan live)", async () => {
    const { supabase, chainsByTable } = makeSupabase({
      active_workout_plans: { data: { routine_plan_id: "plan-1" }, error: null },
      plan_sessions: {
        data: [
          {
            name: "AM Session",
            position: 1,
            schedule_days: [1],
            start_time: null,
            workout_id: "workout-1",
            // The builder's own default (10min/exercise) — sums to 20, not a multiple of 15.
            plan_session_exercises: [{ duration_minutes: 10 }, { duration_minutes: 10 }],
          },
        ],
        error: null,
      },
    });

    await syncWorkoutScheduleForActiveRoutine(supabase, "user-1");

    expect(chainsByTable.workout_schedule.insert).toHaveBeenCalledWith([
      expect.objectContaining({ duration_minutes: 15 }), // 20 rounds down to nearest-15
    ]);
  });

  it("clamps a sum over the 240 ceiling", async () => {
    const { supabase, chainsByTable } = makeSupabase({
      active_workout_plans: { data: { routine_plan_id: "plan-1" }, error: null },
      plan_sessions: {
        data: [
          {
            name: "Long Session",
            position: 1,
            schedule_days: [2],
            start_time: null,
            workout_id: null,
            plan_session_exercises: [{ duration_minutes: 300 }],
          },
        ],
        error: null,
      },
    });

    await syncWorkoutScheduleForActiveRoutine(supabase, "user-1");

    expect(chainsByTable.workout_schedule.insert).toHaveBeenCalledWith([
      expect.objectContaining({ duration_minutes: 240 }),
    ]);
  });

  it("clamps a sum under the 15 floor up to 15, not down to 0 (which the constraint also rejects)", async () => {
    const { supabase, chainsByTable } = makeSupabase({
      active_workout_plans: { data: { routine_plan_id: "plan-1" }, error: null },
      plan_sessions: {
        data: [
          {
            name: "Tiny Session",
            position: 1,
            schedule_days: [3],
            start_time: null,
            workout_id: null,
            plan_session_exercises: [{ duration_minutes: 5 }],
          },
        ],
        error: null,
      },
    });

    await syncWorkoutScheduleForActiveRoutine(supabase, "user-1");

    expect(chainsByTable.workout_schedule.insert).toHaveBeenCalledWith([
      expect.objectContaining({ duration_minutes: 15 }),
    ]);
  });

  it("adversarial: zero/negative/NaN sums become null, never a value the constraint would reject", async () => {
    const { supabase, chainsByTable } = makeSupabase({
      active_workout_plans: { data: { routine_plan_id: "plan-1" }, error: null },
      plan_sessions: {
        data: [
          {
            name: "No Exercises",
            position: 1,
            schedule_days: [4],
            start_time: null,
            workout_id: null,
            plan_session_exercises: [],
          },
        ],
        error: null,
      },
    });

    await syncWorkoutScheduleForActiveRoutine(supabase, "user-1");

    expect(chainsByTable.workout_schedule.insert).toHaveBeenCalledWith([
      expect.objectContaining({ duration_minutes: null }),
    ]);
  });

  it("a sum already a multiple of 15 passes through unchanged", async () => {
    const { supabase, chainsByTable } = makeSupabase({
      active_workout_plans: { data: { routine_plan_id: "plan-1" }, error: null },
      plan_sessions: {
        data: [
          {
            name: "Clean Session",
            position: 1,
            schedule_days: [5],
            start_time: null,
            workout_id: null,
            plan_session_exercises: [{ duration_minutes: 20 }, { duration_minutes: 25 }],
          },
        ],
        error: null,
      },
    });

    await syncWorkoutScheduleForActiveRoutine(supabase, "user-1");

    expect(chainsByTable.workout_schedule.insert).toHaveBeenCalledWith([
      expect.objectContaining({ duration_minutes: 45 }),
    ]);
  });
});

describe("syncWorkoutScheduleForActiveRoutine — collision and clearIfInactive", () => {
  it("two sessions colliding on the same weekday: the lowest-position session wins that day's row", async () => {
    const { supabase, chainsByTable } = makeSupabase({
      active_workout_plans: { data: { routine_plan_id: "plan-1" }, error: null },
      plan_sessions: {
        data: [
          { name: "AM", position: 1, schedule_days: [1], start_time: "07:00", workout_id: "w-am", plan_session_exercises: [] },
          { name: "PM", position: 2, schedule_days: [1], start_time: "18:00", workout_id: "w-pm", plan_session_exercises: [] },
        ],
        error: null,
      },
    });

    await syncWorkoutScheduleForActiveRoutine(supabase, "user-1");

    const inserted = chainsByTable.workout_schedule.insert.mock.calls[0][0];
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ day_of_week: 1, workout_name: "AM", workout_id: "w-am" });
  });

  it("no active routine plan and clearIfInactive false: never touches workout_schedule", async () => {
    const { supabase, chainsByTable } = makeSupabase({
      active_workout_plans: { data: { routine_plan_id: null }, error: null },
    });

    await syncWorkoutScheduleForActiveRoutine(supabase, "user-1");

    expect(chainsByTable.workout_schedule).toBeUndefined();
  });

  it("no active routine plan and clearIfInactive true: deletes but does not reinsert", async () => {
    const { supabase, chainsByTable } = makeSupabase({
      active_workout_plans: { data: { routine_plan_id: null }, error: null },
    });

    await syncWorkoutScheduleForActiveRoutine(supabase, "user-1", { clearIfInactive: true });

    expect(chainsByTable.workout_schedule.delete).toHaveBeenCalled();
    expect(chainsByTable.workout_schedule.insert).not.toHaveBeenCalled();
  });
});
