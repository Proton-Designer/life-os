import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWriteAction, listWriteEntities, listWriteActions } from "../write-registry";

function textOf(outcome: Awaited<ReturnType<NonNullable<ReturnType<typeof getWriteAction>>["handler"]>>) {
  const block = outcome.result.content[0];
  if (block.type !== "text") throw new Error("expected text");
  return JSON.parse(block.text);
}

function makeClient(opts: { singleSeq?: Record<string, unknown[]>; maybeSingleSeq?: Record<string, unknown[]>; rpc?: { data?: unknown; error?: unknown } } = {}) {
  const singleSeq: Record<string, unknown[]> = Object.fromEntries(Object.entries(opts.singleSeq ?? {}).map(([k, v]) => [k, [...v]]));
  const maybeSingleSeq: Record<string, unknown[]> = Object.fromEntries(Object.entries(opts.maybeSingleSeq ?? {}).map(([k, v]) => [k, [...v]]));
  const calls: Record<string, { insert: Record<string, unknown>[]; update: Record<string, unknown>[] }> = {};

  const from = vi.fn((table: string) => {
    calls[table] ??= { insert: [], update: [] };
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      calls[table].insert.push(row);
      return chain;
    });
    chain.update = vi.fn((row: Record<string, unknown>) => {
      calls[table].update.push(row);
      return chain;
    });
    chain.upsert = vi.fn((row: Record<string, unknown>) => {
      calls[table].insert.push(row);
      return { then: (resolve: (v: { error: null }) => void) => resolve({ error: null }) };
    });
    chain.maybeSingle = vi.fn(async () => ({ data: (maybeSingleSeq[table] ?? []).shift() ?? null, error: null }));
    chain.single = vi.fn(async () => ({ data: (singleSeq[table] ?? []).shift() ?? { id: "new-id" }, error: null }));
    chain.then = (resolve: (v: { error: null }) => void) => resolve({ error: null });
    return chain;
  });
  const rpc = vi.fn(async () => ({ data: opts.rpc?.data ?? null, error: opts.rpc?.error ?? null }));
  return { client: { from, rpc } as unknown as SupabaseClient, calls, rpc };
}

const now = new Date("2026-09-09T12:00:00.000Z");

describe("write-registry — fitness dispatch shape", () => {
  it("fitness has exactly workout_session/body_metric/fitness_benchmark/exercise/workout wired for write", () => {
    expect(listWriteEntities("fitness").sort()).toEqual(["body_metric", "exercise", "fitness_benchmark", "workout", "workout_session"]);
  });

  it("workout_session has quick_log/confirm/confirm_plan_session, never edit/remove", () => {
    expect(listWriteActions("fitness", "workout_session").sort()).toEqual(["confirm", "confirm_plan_session", "quick_log"]);
  });

  it("exercise has create/archive, never remove", () => {
    expect(listWriteActions("fitness", "exercise").sort()).toEqual(["archive", "create"]);
  });

  it("workout has rename/archive, never create/save (plan-editing territory)", () => {
    expect(listWriteActions("fitness", "workout").sort()).toEqual(["archive", "rename"]);
  });

  it("the plan-editing/scheduling entities have NO write surface at all -- read-only this pass", () => {
    for (const entity of ["workout_plan", "plan_session", "plan_session_exercise", "plan_micro_exercise", "workout_exercise", "workout_schedule", "active_workout_plan"]) {
      expect(listWriteActions("fitness", entity)).toEqual([]);
    }
  });
});

describe("fitness.workout_session.quick_log", () => {
  it("logs a single-exercise session and returns its real id", async () => {
    const action = getWriteAction("fitness", "workout_session", "quick_log")!;
    const { client, calls } = makeClient({ singleSeq: { workout_sessions: [{ id: "session-new" }] } });

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", exercise_id: "ex-1", exercise_name: "Push-ups", sets: 3, reps: 15 });

    expect(textOf(outcome)).toEqual({ id: "session-new" });
    expect(calls.workout_sessions.insert[0]).toMatchObject({ user_id: "user-1", date: "2026-09-08", source: "quick" });
    expect(calls.session_sets.insert[0]).toMatchObject({ session_id: "session-new", exercise_id: "ex-1" });
  });

  it("REJECTS a missing sets/reps", async () => {
    const action = getWriteAction("fitness", "workout_session", "quick_log")!;
    const { client } = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", exercise_id: "ex-1", exercise_name: "x" }),
    ).rejects.toThrow(/sets/i);
  });
});

describe("fitness.workout_session.confirm", () => {
  it("calls the RPC with the mapped set shape and returns its real session id", async () => {
    const action = getWriteAction("fitness", "workout_session", "confirm")!;
    const { client, rpc } = makeClient({ rpc: { data: "session-rpc" } });

    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now },
      { date: "2026-09-08", workout_id: "w-1", workout_name: "Push Day", sets: [{ exerciseId: "ex-1", exerciseName: "Bench", position: 1, sets: 3, reps: 10, load: 135 }] },
    );

    expect(textOf(outcome)).toEqual({ id: "session-rpc" });
    expect(rpc).toHaveBeenCalledWith("confirm_workout_session", expect.objectContaining({ p_date: "2026-09-08", p_workout_id: "w-1" }));
  });

  it("REJECTS an empty sets array", async () => {
    const action = getWriteAction("fitness", "workout_session", "confirm")!;
    const { client } = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", workout_id: "w-1", workout_name: "x", sets: [] }),
    ).rejects.toThrow(/sets/i);
  });

  it("REJECTS a malformed set entry", async () => {
    const action = getWriteAction("fitness", "workout_session", "confirm")!;
    const { client } = makeClient();
    await expect(
      action.handler(
        { userClient: client, userId: "user-1", timezone: "UTC", now },
        { date: "2026-09-08", workout_id: "w-1", workout_name: "x", sets: [{ exerciseId: "ex-1" }] },
      ),
    ).rejects.toThrow(/exerciseName|sets\[0\]/i);
  });
});

describe("fitness.workout_session.confirm_plan_session", () => {
  it("requires the top-level id (the plan session's id)", async () => {
    const action = getWriteAction("fitness", "workout_session", "confirm_plan_session")!;
    const { client } = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", session_name: "x", sets: [] }),
    ).rejects.toThrow(/top-level `id`/i);
  });

  it("confirms using the top-level id as the plan session id", async () => {
    const action = getWriteAction("fitness", "workout_session", "confirm_plan_session")!;
    const { client, calls } = makeClient({
      maybeSingleSeq: { plan_sessions: [{ workout_id: "w-mirror" }] },
      singleSeq: { workout_sessions: [{ id: "session-new" }] },
    });

    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now, id: "plan-session-1" },
      { date: "2026-09-08", session_name: "Push Day", sets: [{ exerciseId: "ex-1", exerciseName: "Bench", position: 1, sets: 3, reps: 10, load: null }] },
    );

    expect(textOf(outcome)).toEqual({ id: "session-new" });
    expect(calls.workout_sessions.insert[0]).toMatchObject({ plan_session_id: "plan-session-1", workout_id: "w-mirror" });
  });
});

describe("fitness.body_metric", () => {
  it("log_weight preserves the existing waist_in", async () => {
    const action = getWriteAction("fitness", "body_metric", "log_weight")!;
    const { client, calls } = makeClient({ maybeSingleSeq: { body_metrics: [{ waist_in: 32 }] } });

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", weight_lb: 180 });

    expect(textOf(outcome)).toMatchObject({ date: "2026-09-08", weight_lb: 180 });
    expect(calls.body_metrics.insert[0]).toMatchObject({ weight_lb: 180, waist_in: 32 });
  });

  it("log_waist preserves the existing weight_lb", async () => {
    const action = getWriteAction("fitness", "body_metric", "log_waist")!;
    const { client, calls } = makeClient({ maybeSingleSeq: { body_metrics: [{ weight_lb: 180 }] } });

    await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", waist_in: 32 });

    expect(calls.body_metrics.insert[0]).toMatchObject({ waist_in: 32, weight_lb: 180 });
  });
});

describe("fitness.fitness_benchmark.log", () => {
  it("upserts one exercise's max_reps for a date", async () => {
    const action = getWriteAction("fitness", "fitness_benchmark", "log")!;
    const { client, calls } = makeClient();

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", exercise_id: "ex-pullup", max_reps: 12 });

    expect(textOf(outcome)).toMatchObject({ date: "2026-09-08", exercise_id: "ex-pullup", max_reps: 12 });
    expect(calls.fitness_benchmarks.insert[0]).toMatchObject({ exercise_id: "ex-pullup", max_reps: 12 });
  });
});

describe("fitness.exercise", () => {
  it("create inserts and returns the real id", async () => {
    const action = getWriteAction("fitness", "exercise", "create")!;
    const { client, calls } = makeClient({ singleSeq: { exercises: [{ id: "ex-new" }] } });

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { name: "Cable Row", primary_muscles: ["back_lats"] });

    expect(textOf(outcome)).toEqual({ id: "ex-new" });
    expect(calls.exercises.insert[0]).toMatchObject({ name: "Cable Row", primary_muscles: ["back_lats"] });
  });

  it("REJECTS an invalid muscle group", async () => {
    const action = getWriteAction("fitness", "exercise", "create")!;
    const { client } = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { name: "x", primary_muscles: ["not_a_real_muscle"] }),
    ).rejects.toThrow(/muscle/i);
  });

  it("archive updates archived:true, never deletes", async () => {
    const action = getWriteAction("fitness", "exercise", "archive")!;
    const { client, calls } = makeClient();

    await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "ex-1" }, {});

    expect(calls.exercises.update[0]).toMatchObject({ archived: true });
  });
});

describe("fitness.workout", () => {
  it("rename updates name", async () => {
    const action = getWriteAction("fitness", "workout", "rename")!;
    const { client, calls } = makeClient();

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "w-1" }, { name: "Leg Day" });

    expect(textOf(outcome)).toEqual({ id: "w-1" });
    expect(calls.workouts.update[0]).toMatchObject({ name: "Leg Day" });
  });

  it("archive updates archived:true, never deletes", async () => {
    const action = getWriteAction("fitness", "workout", "archive")!;
    const { client, calls } = makeClient();

    await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "w-1" }, {});

    expect(calls.workouts.update[0]).toMatchObject({ archived: true });
  });
});
