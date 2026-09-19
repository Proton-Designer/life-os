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
import { ToolNotFoundError } from "@/lib/mcp/tool-input-error";

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
    // A FOUND plan session (workout_id: null is a legitimate value, not
    // "not found" -- see P4-34 tests below for the actual not-found case)
    // so this test still exercises a genuine insert failure, not the
    // pre-insert existence check.
    const planSessionsChain = makeChain({ data: { workout_id: null }, error: null });
    const insertChain = makeChain({ data: null, error: { code: "23000", message: "other" } });
    const from = vi.fn((table: string) => (table === "plan_sessions" ? planSessionsChain : insertChain));
    const client = { from } as unknown as SupabaseClient;
    await expect(confirmPlanSessionCore(client, "user-1", "2026-09-08", "plan-session-1", "Push Day", [])).rejects.toBeTruthy();
  });

  // P4-34: this is the one case in ENG-A's triage that ISN'T an
  // UPDATE-matched-zero-rows bug -- confirmPlanSessionCore reads
  // plan_sessions by the caller's id, and on a miss it used to silently
  // substitute workout_id: null and INSERT a brand-new workout_sessions row
  // anyway, reporting success with a real new row id for a caller-supplied
  // id that was never valid. The fix has to run BEFORE the insert, not wrap
  // an update that doesn't apply here. Both cases below produce the
  // IDENTICAL "no such plan session" result from the SAME user_id-scoped
  // read -- account A confirming account B's plan session id is
  // indistinguishable from account A confirming an id that never existed.
  describe("P4-34 -- a bad, stale, or cross-tenant plan session id throws BEFORE any row is inserted", () => {
    it("cross-tenant id (account A confirming account B's plan session)", async () => {
      const planSessionsChain = makeChain({ data: null, error: null }); // no row for THIS user_id
      const sessionsChain = makeChain({ data: { id: "should-never-be-created" }, error: null });
      const from = vi.fn((table: string) => (table === "plan_sessions" ? planSessionsChain : sessionsChain));
      const client = { from } as unknown as SupabaseClient;

      await expect(
        confirmPlanSessionCore(client, "user-1", "2026-09-08", "belongs-to-account-b", "Push Day", [])
      ).rejects.toThrow(/No plan session found with id "belongs-to-account-b"/);
      expect(sessionsChain.insert).not.toHaveBeenCalled();
    });

    it("the caller's own stale/deleted plan session id -- the common, non-adversarial case", async () => {
      const planSessionsChain = makeChain({ data: null, error: null });
      const sessionsChain = makeChain({ data: { id: "should-never-be-created" }, error: null });
      const from = vi.fn((table: string) => (table === "plan_sessions" ? planSessionsChain : sessionsChain));
      const client = { from } as unknown as SupabaseClient;

      await expect(
        confirmPlanSessionCore(client, "user-1", "2026-09-08", "deleted-earlier", "Push Day", [])
      ).rejects.toThrow(ToolNotFoundError);
      expect(sessionsChain.insert).not.toHaveBeenCalled();
    });
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

  // P4-34's requireRowUpdated chains .select("id") onto the update and
  // reads its result to detect a zero-row match -- a non-empty row lets a
  // normal, successful archive through unaffected.
  it("archiveExerciseCore updates archived:true, never deletes", async () => {
    const chain = makeChain({ data: [{ id: "ex-1" }], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await archiveExerciseCore(client, "user-1", "ex-1");
    expect(chain.update).toHaveBeenCalledWith({ archived: true });
    expect(chain.delete).not.toHaveBeenCalled();
  });

  // P4-34: both cases below produce the IDENTICAL zero-row result from the
  // same user_id-scoped query -- account A archiving account B's exercise
  // id is indistinguishable from account A archiving an id that never
  // existed.
  it("archiveExerciseCore throws a clean not-found for a cross-tenant id instead of reporting success", async () => {
    const chain = makeChain({ data: [], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await expect(archiveExerciseCore(client, "user-1", "belongs-to-account-b")).rejects.toThrow(
      /No exercise found with id "belongs-to-account-b"/
    );
  });

  it("archiveExerciseCore throws a clean not-found for the caller's own stale/deleted id", async () => {
    const chain = makeChain({ data: [], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await expect(archiveExerciseCore(client, "user-1", "deleted-earlier")).rejects.toThrow(ToolNotFoundError);
  });
});

describe("renameWorkoutCore / archiveWorkoutCore", () => {
  it("renameWorkoutCore updates name, scoped to id and user_id", async () => {
    const chain = makeChain({ data: [{ id: "w-1" }], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await renameWorkoutCore(client, "user-1", "w-1", "Leg Day");
    expect(chain.update).toHaveBeenCalledWith({ name: "Leg Day" });
    expect(chain.eq).toHaveBeenCalledWith("id", "w-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("renameWorkoutCore throws a clean not-found for a cross-tenant or stale id instead of reporting success", async () => {
    const chain = makeChain({ data: [], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await expect(renameWorkoutCore(client, "user-1", "not-mine", "Leg Day")).rejects.toThrow(/No workout found with id "not-mine"/);
  });

  it("archiveWorkoutCore updates archived:true, never deletes", async () => {
    const chain = makeChain({ data: [{ id: "w-1" }], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await archiveWorkoutCore(client, "user-1", "w-1");
    expect(chain.update).toHaveBeenCalledWith({ archived: true });
    expect(chain.delete).not.toHaveBeenCalled();
  });

  it("archiveWorkoutCore throws a clean not-found for a cross-tenant or stale id instead of reporting success", async () => {
    const chain = makeChain({ data: [], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await expect(archiveWorkoutCore(client, "user-1", "not-mine")).rejects.toThrow(/No workout found with id "not-mine"/);
  });
});
