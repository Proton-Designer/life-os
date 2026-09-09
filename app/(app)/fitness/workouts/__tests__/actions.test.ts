import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "update", "insert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock })),
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

// Exercises the R5 core(supabase, userId, ...) extraction
// (lib/fitness/actions-core.ts) through these cookie-authed thin wrappers —
// no existing test file covered createExercise/archiveExercise/
// renameWorkout/archiveWorkout before this refactor.
describe("Fitness workouts actions", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
    revalidatePathMock.mockClear();
  });

  it("createExercise inserts scoped to this user and returns the real id", async () => {
    const chain = makeChain({ data: { id: "ex-new" }, error: null });
    fromImpl = () => chain;
    const { createExercise } = await import("../actions");

    const result = await createExercise("Cable Row", ["back_lats"], ["biceps"]);

    expect(chain.insert).toHaveBeenCalledWith({ user_id: "user-1", name: "Cable Row", primary_muscles: ["back_lats"], secondary_muscles: ["biceps"] });
    expect(result).toEqual({ id: "ex-new" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/fitness/workouts");
  });

  it("archiveExercise updates archived:true, never deletes", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { archiveExercise } = await import("../actions");

    await archiveExercise("ex-1");

    expect(chain.update).toHaveBeenCalledWith({ archived: true });
    expect(chain.delete).not.toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("id", "ex-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("renameWorkout updates name, scoped to id and user_id", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { renameWorkout } = await import("../actions");

    await renameWorkout("w-1", "Leg Day");

    expect(chain.update).toHaveBeenCalledWith({ name: "Leg Day" });
    expect(chain.eq).toHaveBeenCalledWith("id", "w-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/fitness/workouts");
  });

  it("archiveWorkout updates archived:true and revalidates both /fitness/workouts and /fitness", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { archiveWorkout } = await import("../actions");

    await archiveWorkout("w-1");

    expect(chain.update).toHaveBeenCalledWith({ archived: true });
    expect(chain.delete).not.toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalledWith("/fitness/workouts");
    expect(revalidatePathMock).toHaveBeenCalledWith("/fitness");
  });
});
