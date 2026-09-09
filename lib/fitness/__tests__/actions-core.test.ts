import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  quickLogExerciseCore,
  confirmWorkoutSessionCore,
  confirmPlanSessionCore,
  logWeightCore,
  logWaistCore,
  logBenchmarkRepsCore,
  createExerciseCore,
  archiveExerciseCore,
  renameWorkoutCore,
  archiveWorkoutCore,
} from "../actions-core";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "upsert", "update", "insert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

describe("quickLogExerciseCore", () => {
  it("inserts the session, then the single set, in that order", async () => {
    const sessionsChain = makeChain({ data: { id: "session-new" }, error: null });
    const setsChain = makeChain({ data: null, error: null });
    const from = vi.fn((table: string) => (table === "workout_sessions" ? sessionsChain : setsChain));
    const client = { from } as unknown as SupabaseClient;

    const id = await quickLogExerciseCore(client, "user-1", "2026-09-08", "ex-1", "Push-ups", 3, 15, null);

    expect(sessionsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", date: "2026-09-08", workout_id: null, workout_name: null, source: "quick" }),
    );
    expect(setsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: "session-new", exercise_id: "ex-1", exercise_name: "Push-ups", position: 1, sets: 3, reps: 15, load: null }),
    );
    expect(id).toBe("session-new");
  });
});

describe("confirmWorkoutSessionCore", () => {
  it("calls the confirm_workout_session RPC with the mapped set shape, and returns the RPC's real session id", async () => {
    const rpc = vi.fn(async () => ({ data: "session-rpc-id", error: null }));
    const client = { rpc } as unknown as SupabaseClient;

    const id = await confirmWorkoutSessionCore(client, "2026-09-08", "workout-1", "Push Day", [
      { exerciseId: "ex-1", exerciseName: "Bench", position: 1, sets: 3, reps: 10, load: 135 },
    ]);

    expect(rpc).toHaveBeenCalledWith("confirm_workout_session", {
      p_date: "2026-09-08",
      p_workout_id: "workout-1",
      p_workout_name: "Push Day",
      p_sets: [{ exerciseId: "ex-1", exerciseName: "Bench", position: 1, sets: 3, reps: 10, load: 135 }],
    });
    expect(id).toBe("session-rpc-id");
  });

  it("throws on RPC error", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    const client = { rpc } as unknown as SupabaseClient;
    await expect(confirmWorkoutSessionCore(client, "2026-09-08", "w-1", "Push Day", [])).rejects.toBeTruthy();
  });
});

describe("confirmPlanSessionCore", () => {
  it("reads the plan session's workout_id, inserts the session with plan_session_id, then the sets", async () => {
    const planSessionsChain = makeChain({ data: { workout_id: "workout-mirror" }, error: null });
    const sessionsChain = makeChain({ data: { id: "session-new" }, error: null });
    const setsChain = makeChain({ data: null, error: null });
    const from = vi.fn((table: string) => {
      if (table === "plan_sessions") return planSessionsChain;
      if (table === "workout_sessions") return sessionsChain;
      return setsChain;
    });
    const client = { from } as unknown as SupabaseClient;

    const id = await confirmPlanSessionCore(client, "user-1", "2026-09-08", "plan-session-1", "Push Day", [
      { exerciseId: "ex-1", exerciseName: "Bench", position: 1, sets: 3, reps: 10, load: 135 },
    ]);

    expect(sessionsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ workout_id: "workout-mirror", source: "confirmed", plan_session_id: "plan-session-1" }),
    );
    expect(setsChain.insert).toHaveBeenCalledWith([
      expect.objectContaining({ session_id: "session-new", exercise_id: "ex-1" }),
    ]);
    expect(id).toBe("session-new");
  });

  it("on a 23505 (already confirmed), looks up and returns the existing session's id instead of erroring", async () => {
    const planSessionsChain = makeChain({ data: { workout_id: null }, error: null });
    const insertChain = makeChain({ data: null, error: { code: "23505" } });
    const existingLookupChain = makeChain({ data: { id: "session-existing" }, error: null });
    let sessionsCall = 0;
    const from = vi.fn((table: string) => {
      if (table === "plan_sessions") return planSessionsChain;
      if (table === "workout_sessions") {
        sessionsCall += 1;
        return sessionsCall === 1 ? insertChain : existingLookupChain;
      }
      throw new Error("session_sets should never be touched on conflict");
    });
    const client = { from } as unknown as SupabaseClient;

    const id = await confirmPlanSessionCore(client, "user-1", "2026-09-08", "plan-session-1", "Push Day", []);
    expect(id).toBe("session-existing");
  });

  it("throws on a non-conflict session insert error", async () => {
    const planSessionsChain = makeChain({ data: null, error: null });
    const insertChain = makeChain({ data: null, error: { code: "23000", message: "other" } });
    const from = vi.fn((table: string) => (table === "plan_sessions" ? planSessionsChain : insertChain));
    const client = { from } as unknown as SupabaseClient;
    await expect(confirmPlanSessionCore(client, "user-1", "2026-09-08", "plan-session-1", "Push Day", [])).rejects.toBeTruthy();
  });
});

describe("logWeightCore / logWaistCore", () => {
  it("logWeightCore preserves the existing waist_in when upserting weight_lb", async () => {
    const chain = makeChain({ data: { waist_in: 32 }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await logWeightCore(client, "user-1", "2026-09-08", 180);
    expect(chain.upsert).toHaveBeenCalledWith({ user_id: "user-1", date: "2026-09-08", weight_lb: 180, waist_in: 32 }, { onConflict: "user_id,date" });
  });

  it("logWaistCore preserves the existing weight_lb when upserting waist_in", async () => {
    const chain = makeChain({ data: { weight_lb: 180 }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await logWaistCore(client, "user-1", "2026-09-08", 32);
    expect(chain.upsert).toHaveBeenCalledWith({ user_id: "user-1", date: "2026-09-08", waist_in: 32, weight_lb: 180 }, { onConflict: "user_id,date" });
  });
});

describe("logBenchmarkRepsCore", () => {
  it("upserts one exercise's max_reps keyed by (user_id, date, exercise_id)", async () => {
    const chain = makeChain();
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await logBenchmarkRepsCore(client, "user-1", "2026-09-08", "ex-pullup", 12);
    expect(chain.upsert).toHaveBeenCalledWith(
      { user_id: "user-1", date: "2026-09-08", exercise_id: "ex-pullup", max_reps: 12 },
      { onConflict: "user_id,date,exercise_id" },
    );
  });
});

describe("createExerciseCore / archiveExerciseCore", () => {
  it("createExerciseCore inserts and returns the real id", async () => {
    const chain = makeChain({ data: { id: "ex-new" }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    const id = await createExerciseCore(client, "user-1", "Cable Row", ["back_lats"], ["biceps"]);
    expect(chain.insert).toHaveBeenCalledWith({ user_id: "user-1", name: "Cable Row", primary_muscles: ["back_lats"], secondary_muscles: ["biceps"] });
    expect(id).toBe("ex-new");
  });

  it("archiveExerciseCore updates archived:true, never deletes", async () => {
    const chain = makeChain();
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await archiveExerciseCore(client, "user-1", "ex-1");
    expect(chain.update).toHaveBeenCalledWith({ archived: true });
    expect(chain.delete).not.toHaveBeenCalled();
  });
});

describe("renameWorkoutCore / archiveWorkoutCore", () => {
  it("renameWorkoutCore updates name, scoped to id and user_id", async () => {
    const chain = makeChain();
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await renameWorkoutCore(client, "user-1", "w-1", "Leg Day");
    expect(chain.update).toHaveBeenCalledWith({ name: "Leg Day" });
    expect(chain.eq).toHaveBeenCalledWith("id", "w-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("archiveWorkoutCore updates archived:true, never deletes", async () => {
    const chain = makeChain();
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await archiveWorkoutCore(client, "user-1", "w-1");
    expect(chain.update).toHaveBeenCalledWith({ archived: true });
    expect(chain.delete).not.toHaveBeenCalled();
  });
});
