import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(responses: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "ilike", "order", "upsert", "update", "insert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  const resolved = { data: responses.data ?? null, error: responses.error ?? null };
  chain.single = vi.fn(async () => resolved);
  chain.maybeSingle = vi.fn(async () => resolved);
  chain.then = (resolve: (v: typeof resolved) => void) => resolve(resolved);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
let tableResponses: Record<string, { data: unknown; error: unknown }>;
let sessionInsertCount = 0;
const chainsByTable: Record<string, ReturnType<typeof makeChain>> = {};

function defaultFromImpl(table: string) {
  if (!chainsByTable[table]) chainsByTable[table] = makeChain(tableResponses[table] ?? {});
  if (table === "exercises" && !("insertOverridden" in chainsByTable[table])) {
    // find-or-create: no existing exercise by name -> maybeSingle resolves null, insert creates a fresh id per call.
    let n = 0;
    chainsByTable[table].insert = vi.fn(() => ({
      select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: `exercise-${++n}` }, error: null })) })),
    }));
    (chainsByTable[table] as Record<string, unknown>).insertOverridden = true;
  }
  if (table === "workout_plans" && !("insertOverridden" in chainsByTable[table])) {
    chainsByTable[table].insert = vi.fn(() => ({
      select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: "new-plan-id" }, error: null })) })),
    }));
    (chainsByTable[table] as Record<string, unknown>).insertOverridden = true;
  }
  if (table === "workouts" && !("insertOverridden" in chainsByTable[table])) {
    // The backing-workouts-row-per-session materialization (040) — each
    // call gets a fresh id, same pattern as exercises' find-or-create.
    let w = 0;
    chainsByTable[table].insert = vi.fn(() => ({
      select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: `workout-${++w}` }, error: null })) })),
    }));
    (chainsByTable[table] as Record<string, unknown>).insertOverridden = true;
  }
  if (table === "plan_sessions" && !("insertOverridden" in chainsByTable[table])) {
    chainsByTable[table].insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => {
          sessionInsertCount++;
          return { data: { id: `session-${sessionInsertCount}` }, error: null };
        }),
      })),
    }));
    (chainsByTable[table] as Record<string, unknown>).insertOverridden = true;
  }
  return chainsByTable[table];
}
const fromMock = vi.fn(defaultFromImpl);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("createPlanFromTemplate", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
    fromMock.mockImplementation(defaultFromImpl);
    sessionInsertCount = 0;
    tableResponses = {
      exercises: { data: null, error: null }, // no existing exercise by name
      workout_plans: { data: null, error: null }, // no existing plan by name
      active_workout_plans: { data: { micro_plan_id: null, routine_plan_id: null }, error: null },
      workout_schedule: { data: null, error: null },
    };
    for (const key of Object.keys(chainsByTable)) delete chainsByTable[key];
  });

  it("is idempotent: an existing plan of the same name is returned, nothing re-created", async () => {
    tableResponses.workout_plans = { data: { id: "existing-plan" }, error: null };
    const { createPlanFromTemplate } = await import("../template-actions");

    const result = await createPlanFromTemplate("starter_reps");

    expect(result).toEqual({ id: "existing-plan" });
    expect(chainsByTable.workout_plans.insert).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalledWith("plan_micro_exercises");
  });

  it("starter_reps materializes both rep goals as plan_micro_exercises and activates the micro slot", async () => {
    const { createPlanFromTemplate } = await import("../template-actions");

    const result = await createPlanFromTemplate("starter_reps");

    expect(result).toEqual({ id: "new-plan-id" });
    expect(chainsByTable.workout_plans.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", name: "Starter Reps", kind: "micro" })
    );
    expect(chainsByTable.plan_micro_exercises.insert).toHaveBeenCalledWith([
      expect.objectContaining({ goal_value: 30, goal_type: "daily_total", position: 1 }),
      expect.objectContaining({ goal_value: 100, goal_type: "daily_total", position: 2 }),
    ]);
    expect(chainsByTable.active_workout_plans.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ micro_plan_id: "new-plan-id", routine_plan_id: null }),
      { onConflict: "user_id" }
    );
    // micro plan activation never concerns the routine slot / schedule.
    expect(fromMock).not.toHaveBeenCalledWith("workout_schedule");
  });

  it("plan_a materializes sessions with schedule_days derived from weekdayWorkoutNames and activates the routine slot", async () => {
    const { createPlanFromTemplate } = await import("../template-actions");

    await createPlanFromTemplate("plan_a");

    expect(chainsByTable.workout_plans.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Rotating Upper", kind: "routine" })
    );
    // Plan A: Session A on Mon/Wed/Fri (1,3,5), Session B on Tue/Thu (2,4).
    const sessionCalls = chainsByTable.plan_sessions.insert.mock.calls.map((c) => c[0]);
    expect(sessionCalls).toEqual([
      expect.objectContaining({ name: "Plan A — Session A", schedule_days: [1, 3, 5], position: 1 }),
      expect.objectContaining({ name: "Plan A — Session B", schedule_days: [2, 4], position: 2 }),
    ]);
    expect(chainsByTable.active_workout_plans.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ routine_plan_id: "new-plan-id" }),
      { onConflict: "user_id" }
    );
    expect(fromMock).toHaveBeenCalledWith("workout_schedule");
  });
});

// ONB item 6 follow-up (BRIEF-eng1-item6.md): the onboarding fitness question
// wrote FitnessConfig.style and nothing ever read it. applyOnboardingFitnessChoice
// gives it a real effect through the SAME templates/slots as the in-app "New
// plan" flow (createPlanFromTemplate/deactivateSlot) -- not a parallel mechanism.
describe("applyOnboardingFitnessChoice", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
    fromMock.mockImplementation(defaultFromImpl);
    sessionInsertCount = 0;
    tableResponses = {
      exercises: { data: null, error: null },
      workout_plans: { data: null, error: null },
      active_workout_plans: { data: { micro_plan_id: null, routine_plan_id: null }, error: null },
      workout_schedule: { data: null, error: null },
    };
    for (const key of Object.keys(chainsByTable)) delete chainsByTable[key];
  });

  it('"plan" materializes Plan A into the routine slot', async () => {
    const { applyOnboardingFitnessChoice } = await import("../template-actions");

    await applyOnboardingFitnessChoice("plan");

    expect(chainsByTable.workout_plans.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Rotating Upper", kind: "routine" })
    );
    expect(chainsByTable.active_workout_plans.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ routine_plan_id: "new-plan-id" }),
      { onConflict: "user_id" }
    );
  });

  it('"ad_hoc" materializes Starter Reps into the micro slot', async () => {
    const { applyOnboardingFitnessChoice } = await import("../template-actions");

    await applyOnboardingFitnessChoice("ad_hoc");

    expect(chainsByTable.workout_plans.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Starter Reps", kind: "micro" })
    );
    expect(chainsByTable.active_workout_plans.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ micro_plan_id: "new-plan-id" }),
      { onConflict: "user_id" }
    );
  });

  it('switching to "plan" deactivates a previously-onboarded ad-hoc slot ("Starter Reps")', async () => {
    tableResponses.active_workout_plans = { data: { micro_plan_id: "old-micro", routine_plan_id: null }, error: null };
    // The routine plan (plan_a "Rotating Upper") doesn't exist yet -> insert path.
    // The micro plan lookup (for the deactivate check) must return the onboarding name.
    const originalWorkoutPlansSelect = () => {};
    void originalWorkoutPlansSelect;
    const { applyOnboardingFitnessChoice } = await import("../template-actions");

    // workout_plans.select().eq(...).maybeSingle() is used both by
    // findExistingPlan (ilike name -> null, so it inserts) and by this
    // function's own "what's in the other slot" lookup (eq id -> a name).
    // The shared chain mock always returns tableResponses.workout_plans, so
    // point it at the onboarding micro template's name for this case.
    tableResponses.workout_plans = { data: { name: "Starter Reps" }, error: null };

    await applyOnboardingFitnessChoice("plan");

    expect(chainsByTable.active_workout_plans.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ micro_plan_id: null }),
      { onConflict: "user_id" }
    );
  });

  it('never deactivates the other slot when it holds something this function did not create', async () => {
    tableResponses.active_workout_plans = { data: { micro_plan_id: "hand-built-micro", routine_plan_id: null }, error: null };
    tableResponses.workout_plans = { data: { name: "My Own Custom Micro Plan" }, error: null };
    const { applyOnboardingFitnessChoice } = await import("../template-actions");

    await applyOnboardingFitnessChoice("plan");

    // Only the routine-activation upsert should have fired -- no upsert
    // clearing the micro slot.
    const upsertCalls = chainsByTable.active_workout_plans.upsert.mock.calls;
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0][0]).toEqual(expect.objectContaining({ micro_plan_id: "hand-built-micro" }));
  });
});
