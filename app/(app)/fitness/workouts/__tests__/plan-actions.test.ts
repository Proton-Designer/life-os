import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(responses: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "not", "in", "order", "upsert", "update", "insert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  const resolved = { data: responses.data ?? null, error: responses.error ?? null };
  chain.single = vi.fn(async () => resolved);
  chain.maybeSingle = vi.fn(async () => resolved);
  chain.then = (resolve: (v: typeof resolved) => void) => resolve(resolved);
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    not: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    then: (resolve: (v: { data: unknown; error: unknown }) => void) => void;
  };
}

const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
let tableResponses: Record<string, { data: unknown; error: unknown }>;
const chainsByTable: Record<string, ReturnType<typeof makeChain>> = {};
function defaultFromImpl(table: string) {
  if (!chainsByTable[table]) chainsByTable[table] = makeChain(tableResponses[table] ?? {});
  return chainsByTable[table];
}
const fromMock = vi.fn(defaultFromImpl);
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock })),
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

describe("plan-actions", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
    fromMock.mockImplementation(defaultFromImpl);
    revalidatePathMock.mockClear();
    tableResponses = {
      active_workout_plans: { data: { micro_plan_id: null, routine_plan_id: null }, error: null },
      workout_schedule: { data: null, error: null },
      plan_sessions: { data: [], error: null },
      workouts: { data: { id: "workout-1" }, error: null },
    };
    for (const key of Object.keys(chainsByTable)) delete chainsByTable[key];
  });

  it("savePlan (micro, create) inserts the plan then delete+insert its exercises, and re-syncs workout_schedule", async () => {
    tableResponses.workout_plans = { data: { id: "plan-1" }, error: null };
    const { savePlan } = await import("../plan-actions");

    const result = await savePlan({
      kind: "micro",
      id: null,
      name: "Starter Reps",
      exercises: [
        { id: null, exerciseId: "ex-1", name: "Pull-ups", scheduleDays: [1, 2, 3, 4, 5], goalType: "daily_total", goalValue: 30, notes: null },
      ],
    });

    expect(result).toEqual({ id: "plan-1" });
    expect(fromMock).toHaveBeenCalledWith("workout_plans");
    expect(chainsByTable.workout_plans.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", name: "Starter Reps", kind: "micro" })
    );
    expect(chainsByTable.plan_micro_exercises.delete).toHaveBeenCalled();
    expect(chainsByTable.plan_micro_exercises.insert).toHaveBeenCalledWith([
      expect.objectContaining({ plan_id: "plan-1", exercise_id: "ex-1", position: 1, goal_type: "daily_total", goal_value: 30 }),
    ]);
    // The shim: reads the active slot on every save, but a micro-plan save
    // never concerns the routine slot — with no active routine plan, it
    // must NOT touch workout_schedule at all (2026-08-22 review catch).
    expect(fromMock).toHaveBeenCalledWith("active_workout_plans");
    expect(fromMock).not.toHaveBeenCalledWith("workout_schedule");
  });

  it("does not wipe legacy workout_schedule rows when saving a micro plan with no active routine plan", async () => {
    tableResponses.workout_plans = { data: { id: "plan-legacy" }, error: null };
    tableResponses.active_workout_plans = { data: { micro_plan_id: null, routine_plan_id: null }, error: null };
    const { savePlan } = await import("../plan-actions");

    await savePlan({ kind: "micro", id: null, name: "M", exercises: [] });

    expect(fromMock).not.toHaveBeenCalledWith("workout_schedule");
  });

  it("savePlan (routine, edit) updates the plan name, replaces sessions+exercises, and re-syncs when it's the active routine", async () => {
    tableResponses.workout_plans = { data: { id: "plan-2", kind: "routine" }, error: null };
    tableResponses.active_workout_plans = { data: { micro_plan_id: null, routine_plan_id: "plan-2" }, error: null };
    let sessionInsertCall = 0;
    const { savePlan } = await import("../plan-actions");
    fromMock.mockImplementation((table: string) => {
      if (!chainsByTable[table]) chainsByTable[table] = makeChain(tableResponses[table] ?? {});
      if (table === "plan_sessions") {
        const chain = chainsByTable[table];
        chain.insert = vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => {
              sessionInsertCall++;
              return { data: { id: `session-${sessionInsertCall}` }, error: null };
            }),
          })),
        }));
      }
      return chainsByTable[table];
    });

    await savePlan({
      kind: "routine",
      id: "plan-2",
      name: "Push / Pull",
      sessions: [
        {
          id: null,
          name: "Push Day",
          scheduleDays: [1],
          startTime: "07:00",
          exercises: [{ id: null, exerciseId: "ex-a", name: "Bench", durationMinutes: 20, loadLb: null, targetSets: null, targetReps: null }],
        },
      ],
    });

    expect(chainsByTable.workout_plans.update).toHaveBeenCalledWith({ name: "Push / Pull" });
    expect(chainsByTable.plan_sessions.delete).toHaveBeenCalled();
    expect(chainsByTable.plan_session_exercises.insert).toHaveBeenCalledWith([
      expect.objectContaining({ session_id: "session-1", exercise_id: "ex-a", duration_minutes: 20 }),
    ]);
    expect(chainsByTable.workout_schedule.delete).toHaveBeenCalled();
  });

  it("savePlan (routine, edit): reuses a kept session's backing workout_id by session id, archives a removed session's, creates fresh for a brand-new one", async () => {
    tableResponses.workout_plans = { data: { id: "plan-2", kind: "routine" }, error: null };
    tableResponses.active_workout_plans = { data: { micro_plan_id: null, routine_plan_id: null }, error: null };
    let sessionInsertCall = 0;
    let workoutInsertCall = 0;
    const { savePlan } = await import("../plan-actions");
    fromMock.mockImplementation((table: string) => {
      if (!chainsByTable[table]) chainsByTable[table] = makeChain(tableResponses[table] ?? {});
      const chain = chainsByTable[table];
      // Guarded so repeated .from(table) calls (the loop calls .from
      // once per session) don't stomp the mock's own call history each
      // time — every real query builder call goes through the SAME
      // vi.fn(), only set up once here.
      if (table === "plan_sessions" && !("insertOverridden" in chain)) {
        // The pre-delete read (select("id, workout_id")) resolves via the
        // default chain.then; only .insert (the reinsert loop) needs a
        // distinct id-generating override.
        chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
          resolve({
            data: [
              { id: "session-kept", workout_id: "workout-kept" },
              { id: "session-removed", workout_id: "workout-removed" },
            ],
            error: null,
          });
        chain.insert = vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => {
              sessionInsertCall++;
              return { data: { id: `session-new-${sessionInsertCall}` }, error: null };
            }),
          })),
        }));
        (chain as Record<string, unknown>).insertOverridden = true;
      }
      if (table === "workouts" && !("insertOverridden" in chain)) {
        chain.insert = vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => {
              workoutInsertCall++;
              return { data: { id: `workout-new-${workoutInsertCall}` }, error: null };
            }),
          })),
        }));
        (chain as Record<string, unknown>).insertOverridden = true;
      }
      return chain;
    });

    await savePlan({
      kind: "routine",
      id: "plan-2",
      name: "Push / Pull",
      sessions: [
        { id: "session-kept", name: "Push Day", scheduleDays: [1], startTime: "07:00", exercises: [] },
        { id: null, name: "New Day", scheduleDays: [2], startTime: null, exercises: [] },
      ],
    });

    // Removed session's backing row is archived, not deleted.
    expect(chainsByTable.workouts.update).toHaveBeenCalledWith({ archived: true });
    expect(chainsByTable.workouts.in).toHaveBeenCalledWith("id", ["workout-removed"]);
    // Only ONE fresh workouts row created — for the brand-new session, not the kept one.
    expect(workoutInsertCall).toBe(1);
    // The kept session's reinsert carries its OLD workout_id, not a new one.
    expect(chainsByTable.plan_sessions.insert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: "Push Day", workout_id: "workout-kept" })
    );
    expect(chainsByTable.plan_sessions.insert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: "New Day", workout_id: "workout-new-1" })
    );
  });

  it("deletePlan deletes the owned plan; does not touch workout_schedule when there's no active routine plan at all", async () => {
    tableResponses.workout_plans = { data: null, error: null };
    tableResponses.active_workout_plans = { data: { micro_plan_id: null, routine_plan_id: null }, error: null };
    const { deletePlan } = await import("../plan-actions");

    await deletePlan("plan-3");

    expect(chainsByTable.workout_plans.delete).toHaveBeenCalled();
    expect(chainsByTable.workout_plans.eq).toHaveBeenCalledWith("id", "plan-3");
    expect(fromMock).toHaveBeenCalledWith("active_workout_plans");
    expect(fromMock).not.toHaveBeenCalledWith("workout_schedule");
  });

  it("deletePlan archives every session's backing workout_id before the cascade", async () => {
    tableResponses.workout_plans = { data: null, error: null };
    tableResponses.active_workout_plans = { data: { micro_plan_id: null, routine_plan_id: null }, error: null };
    tableResponses.plan_sessions = {
      data: [{ workout_id: "workout-a" }, { workout_id: "workout-b" }],
      error: null,
    };
    const { deletePlan } = await import("../plan-actions");

    await deletePlan("plan-3");

    expect(chainsByTable.workouts.update).toHaveBeenCalledWith({ archived: true });
    expect(chainsByTable.workouts.in).toHaveBeenCalledWith("id", ["workout-a", "workout-b"]);
  });

  it("deletePlan still fully re-derives workout_schedule when a DIFFERENT plan is the active routine", async () => {
    tableResponses.workout_plans = { data: null, error: null };
    tableResponses.active_workout_plans = { data: { micro_plan_id: null, routine_plan_id: "some-other-plan" }, error: null };
    const { deletePlan } = await import("../plan-actions");

    await deletePlan("plan-3");

    expect(chainsByTable.workout_schedule.delete).toHaveBeenCalled();
  });

  it("deletePlan clears workout_schedule when the deleted plan WAS the active routine", async () => {
    tableResponses.workout_plans = { data: null, error: null };
    // ON DELETE SET NULL means by the time the sync's own read runs (after
    // the delete), the active row's routine_plan_id is already null — the
    // pre-delete read is what tells deletePlan this plan was the routine
    // slot, so clearIfInactive is passed through correctly either way.
    let readCount = 0;
    fromMock.mockImplementation((table: string) => {
      if (!chainsByTable[table]) chainsByTable[table] = makeChain(tableResponses[table] ?? {});
      if (table === "active_workout_plans") {
        const chain = chainsByTable[table];
        chain.maybeSingle = vi.fn(async () => {
          readCount++;
          return readCount === 1
            ? { data: { micro_plan_id: null, routine_plan_id: "plan-4" }, error: null }
            : { data: { micro_plan_id: null, routine_plan_id: null }, error: null };
        });
      }
      return chainsByTable[table];
    });
    const { deletePlan } = await import("../plan-actions");

    await deletePlan("plan-4");

    expect(chainsByTable.workout_schedule.delete).toHaveBeenCalled();
  });

  it("activatePlan verifies ownership+kind, sets the slot preserving the other slot, and re-syncs", async () => {
    tableResponses.workout_plans = { data: { id: "plan-4", kind: "routine" }, error: null };
    tableResponses.active_workout_plans = { data: { micro_plan_id: "micro-existing", routine_plan_id: null }, error: null };
    const { activatePlan } = await import("../plan-actions");

    await activatePlan("plan-4", "routine");

    expect(chainsByTable.active_workout_plans.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", micro_plan_id: "micro-existing", routine_plan_id: "plan-4" }),
      { onConflict: "user_id" }
    );
  });

  it("activatePlan throws when the plan's kind doesn't match the requested slot", async () => {
    tableResponses.workout_plans = { data: { id: "plan-5", kind: "micro" }, error: null };
    const { activatePlan } = await import("../plan-actions");

    await expect(activatePlan("plan-5", "routine")).rejects.toThrow();
  });

  it("deactivateSlot clears only the requested slot", async () => {
    tableResponses.active_workout_plans = { data: { micro_plan_id: "micro-1", routine_plan_id: "routine-1" }, error: null };
    const { deactivateSlot } = await import("../plan-actions");

    await deactivateSlot("routine");

    expect(chainsByTable.active_workout_plans.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ micro_plan_id: "micro-1", routine_plan_id: null }),
      { onConflict: "user_id" }
    );
  });
});
