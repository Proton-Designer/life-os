import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "upsert", "update", "insert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };
}

const getUserMock = vi.fn(async () => ({ data: { user: { id: "user-1" } } }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock }, from: fromMock })),
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

describe("Fitness actions", () => {
  beforeEach(() => {
    getUserMock.mockClear();
    fromMock.mockClear();
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

  it("setWorkoutSchedule revalidates '/' too — Home reads workout_schedule via getWorkoutSchedule", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { setWorkoutSchedule } = await import("../actions");

    await setWorkoutSchedule(1, "Push", "18:00");

    expect(revalidatePathMock).toHaveBeenCalledWith("/fitness");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });

  it("logWorkout inserts a workout_logs row with the given source", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { logWorkout } = await import("../actions");

    await logWorkout("2026-08-10", "Push", "adhoc");

    expect(fromMock).toHaveBeenCalledWith("workout_logs");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        date: "2026-08-10",
        workout_name: "Push",
        source: "adhoc",
      })
    );
  });
});
