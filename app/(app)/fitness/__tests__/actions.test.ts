import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "upsert", "update", "insert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
  };
}

const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));
const rpcMock = vi.fn(async (..._args: unknown[]) => ({ data: null, error: null }));
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock, rpc: rpcMock })),
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

describe("Fitness actions", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
    rpcMock.mockClear();
    revalidatePathMock.mockClear();
  });

  it("addHabit inserts into custom_habits scoped to domain 'fitness'", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { addHabit } = await import("../actions");

    await addHabit("Drink water");

    expect(fromMock).toHaveBeenCalledWith("custom_habits");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", domain: "fitness", name: "Drink water" })
    );
  });

  it("toggleHabit upserts habit_logs keyed by (habit_id, date)", async () => {
    const chain = makeChain({ data: { completed: false }, error: null });
    fromImpl = () => chain;
    const { toggleHabit } = await import("../actions");

    await toggleHabit("habit-1", "2026-08-10");

    expect(fromMock).toHaveBeenCalledWith("habit_logs");
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ habit_id: "habit-1", date: "2026-08-10", completed: true }),
      expect.objectContaining({ onConflict: "habit_id,date" })
    );
  });

  it("removeHabit archives rather than hard-deletes, scoped to the user", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { removeHabit } = await import("../actions");

    await removeHabit("habit-1");

    expect(fromMock).toHaveBeenCalledWith("custom_habits");
    expect(chain.update).toHaveBeenCalledWith({ archived: true });
    expect(chain.eq).toHaveBeenCalledWith("id", "habit-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("setWorkoutSchedule upserts keyed by (user_id, day_of_week)", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { setWorkoutSchedule } = await import("../actions");

    await setWorkoutSchedule(1, "Push", "18:00");

    expect(fromMock).toHaveBeenCalledWith("workout_schedule");
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        day_of_week: 1,
        workout_name: "Push",
        time: "18:00",
      }),
      expect.objectContaining({ onConflict: "user_id,day_of_week" })
    );
  });

  it("setWorkoutSchedule upserts duration_minutes when given, and null when omitted", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { setWorkoutSchedule } = await import("../actions");

    await setWorkoutSchedule(1, "Push", "18:00", 75);
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ duration_minutes: 75 }),
      expect.anything()
    );

    await setWorkoutSchedule(2, "Legs", "18:00");
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ duration_minutes: null }),
      expect.anything()
    );
  });

  it("setWorkoutSchedule revalidates '/' too — Home reads workout_schedule via getWorkoutSchedule", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { setWorkoutSchedule } = await import("../actions");

    await setWorkoutSchedule(1, "Push", "18:00");

    expect(revalidatePathMock).toHaveBeenCalledWith("/fitness");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });

  // logWorkout is deleted, not repointed (Fitness redesign Phase 7,
  // 2026-08-20): its last caller (Home's toggle_workout priority item) was
  // deleted as an architecture fix (commit 68755b8 — spec §2.1 forbids a
  // bare one-tap completion with no numbers shown), and workout_logs
  // itself was dropped once genuinely zero readers/writers remained
  // (migration 033). This test asserted the old contract and is removed
  // alongside the function it tested.

  // The tests below exercise the R5 core(supabase, userId, ...) extraction
  // (lib/fitness/actions-core.ts) through its thin cookie-authed wrappers —
  // same end-to-end shape the pre-existing tests above already use, not a
  // mocked-core shortcut, so a regression in the core itself would still
  // fail here.
  it("quickLogExercise inserts the session then the set, scoped to this user", async () => {
    const sessionsChain = makeChain({ data: { id: "session-new" }, error: null });
    const setsChain = makeChain();
    fromImpl = (table) => (table === "workout_sessions" ? sessionsChain : setsChain);
    const { quickLogExercise } = await import("../actions");

    await quickLogExercise("2026-09-08", "ex-1", "Push-ups", 3, 15, null);

    expect(sessionsChain.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1", source: "quick" }));
    expect(setsChain.insert).toHaveBeenCalledWith(expect.objectContaining({ session_id: "session-new", exercise_id: "ex-1" }));
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("confirmWorkoutSession calls the confirm_workout_session RPC with the mapped set shape", async () => {
    const { confirmWorkoutSession } = await import("../actions");

    await confirmWorkoutSession("2026-09-08", "workout-1", "Push Day", [
      { exerciseId: "ex-1", exerciseName: "Bench", position: 1, sets: 3, reps: 10, load: 135 },
    ]);

    expect(rpcMock).toHaveBeenCalledWith("confirm_workout_session", expect.objectContaining({ p_date: "2026-09-08", p_workout_id: "workout-1" }));
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("confirmPlanSession reads the plan session's workout_id then inserts session+sets", async () => {
    const planSessionsChain = makeChain({ data: { workout_id: "workout-mirror" }, error: null });
    const sessionsChain = makeChain({ data: { id: "session-new" }, error: null });
    const setsChain = makeChain();
    fromImpl = (table) => {
      if (table === "plan_sessions") return planSessionsChain;
      if (table === "workout_sessions") return sessionsChain;
      return setsChain;
    };
    const { confirmPlanSession } = await import("../actions");

    await confirmPlanSession("2026-09-08", "plan-session-1", "Push Day", [
      { exerciseId: "ex-1", exerciseName: "Bench", position: 1, sets: 3, reps: 10, load: 135 },
    ]);

    expect(sessionsChain.insert).toHaveBeenCalledWith(expect.objectContaining({ plan_session_id: "plan-session-1", workout_id: "workout-mirror" }));
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("logWeight preserves the existing waist_in", async () => {
    const chain = makeChain({ data: { waist_in: 32 }, error: null });
    fromImpl = () => chain;
    const { logWeight } = await import("../actions");

    await logWeight("2026-09-08", 180);

    expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ weight_lb: 180, waist_in: 32 }), expect.anything());
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("logWaist preserves the existing weight_lb", async () => {
    const chain = makeChain({ data: { weight_lb: 180 }, error: null });
    fromImpl = () => chain;
    const { logWaist } = await import("../actions");

    await logWaist("2026-09-08", 32);

    expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ waist_in: 32, weight_lb: 180 }), expect.anything());
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  // PERF-3: the logging actions are lean (no inline re-render wait); the UI runs one
  // deferred, data-free refresh.
  it("refreshFitnessViews revalidates /fitness, Home and the domains-mode area route, touching no data", async () => {
    const { refreshFitnessViews } = await import("../actions");
    await refreshFitnessViews();
    expect(revalidatePathMock).toHaveBeenCalledWith("/fitness");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(revalidatePathMock).toHaveBeenCalledWith("/personal/[subdomain]");
  });
});
