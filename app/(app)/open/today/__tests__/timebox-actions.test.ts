import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["update", "eq"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

let currentChain: ReturnType<typeof makeChain>;
const requireUserMock = vi.fn(async () => ({
  supabase: { from: vi.fn(() => currentChain) } as unknown as SupabaseClient,
  userId: "user-1",
}));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: () => requireUserMock() }));
const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePathMock(...a) }));

const { setTaskPlannedStartTime, clearTaskPlannedStartTime } = await import("../timebox-actions");

beforeEach(() => {
  requireUserMock.mockClear();
});

describe("setTaskPlannedStartTime", () => {
  it("updates a valid HH:MM time, scoped to this task and user", async () => {
    currentChain = makeChain({ data: null, error: null });
    const result = await setTaskPlannedStartTime("task-1", "09:30");
    expect(result.ok).toBe(true);
    expect(currentChain.update).toHaveBeenCalledWith({ planned_start_time: "09:30" });
    expect(currentChain.eq).toHaveBeenCalledWith("id", "task-1");
    expect(currentChain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("THE REGRESSION GUARD: rejects a malformed time BEFORE ever calling requireUser (no DB round trip for bad input)", async () => {
    const result = await setTaskPlannedStartTime("task-1", "25:99");
    expect(result.ok).toBe(false);
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it("a write error surfaces as ok:false, not a throw", async () => {
    currentChain = makeChain({ data: null, error: { message: "boom" } });
    const result = await setTaskPlannedStartTime("task-1", "09:30");
    expect(result.ok).toBe(false);
  });
});

describe("clearTaskPlannedStartTime", () => {
  it("writes null, scoped to this task and user", async () => {
    currentChain = makeChain({ data: null, error: null });
    const result = await clearTaskPlannedStartTime("task-1");
    expect(result.ok).toBe(true);
    expect(currentChain.update).toHaveBeenCalledWith({ planned_start_time: null });
    expect(currentChain.eq).toHaveBeenCalledWith("id", "task-1");
    expect(currentChain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("a write error surfaces as ok:false, not a throw", async () => {
    currentChain = makeChain({ data: null, error: { message: "boom" } });
    const result = await clearTaskPlannedStartTime("task-1");
    expect(result.ok).toBe(false);
  });
});

// IA-P2 review F1: the timebox editor is on Home's Today strip, so a save/clear must refresh Home.
describe("timebox actions revalidate Home", () => {
  it("setTaskPlannedStartTime and clearTaskPlannedStartTime revalidate '/' (positive control: an invalid time writes nothing and revalidates nothing)", async () => {
    currentChain = makeChain({ data: null, error: null });
    revalidatePathMock.mockClear();
    await setTaskPlannedStartTime("t1", "not-a-time");
    expect(revalidatePathMock).not.toHaveBeenCalled();
    await setTaskPlannedStartTime("t1", "09:30");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    revalidatePathMock.mockClear();
    await clearTaskPlannedStartTime("t1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });
});
