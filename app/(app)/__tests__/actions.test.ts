import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PriorityItem } from "@/lib/home/types";

function makeChain() {
  const chain: Record<string, unknown> = {};
  chain.upsert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.then = (resolve: (v: { error: null }) => void) => resolve({ error: null });
  return chain as {
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
  };
}

const fromMock = vi.fn();
const getUserMock = vi.fn(async () => ({
  data: { user: { id: "user-1" } as { id: string } | null },
}));
const signOutMock = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock, signOut: signOutMock },
    from: fromMock,
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const redirectMock = vi.fn(() => {
  throw new Error("NEXT_REDIRECT");
});

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

function baseItem(overrides: Partial<PriorityItem>): PriorityItem {
  return {
    id: "x",
    domain: "deen",
    title: "x",
    dueAt: null,
    date: "2026-08-10",
    urgencyBucket: "later_today",
    completed: false,
    actionType: "toggle_prayer",
    actionRefId: "fajr",
    ...overrides,
  };
}

describe("toggleItem", () => {
  beforeEach(() => {
    fromMock.mockReset();
    getUserMock.mockClear();
  });

  it("upserts prayers keyed by prayer_name for toggle_prayer", async () => {
    const chain = makeChain();
    fromMock.mockReturnValue(chain);
    const { toggleItem } = await import("../actions");

    await toggleItem(baseItem({ actionType: "toggle_prayer", actionRefId: "dhuhr", date: "2026-08-10" }));

    expect(fromMock).toHaveBeenCalledWith("prayers");
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        date: "2026-08-10",
        prayer_name: "dhuhr",
        status: "on_time",
      }),
      expect.objectContaining({ onConflict: "user_id,date,prayer_name" })
    );
  });

  it("updates kill_list_items.completed by id for toggle_kill_list", async () => {
    const chain = makeChain();
    fromMock.mockReturnValue(chain);
    const { toggleItem } = await import("../actions");

    await toggleItem(baseItem({ actionType: "toggle_kill_list", actionRefId: "kill-item-1" }));

    expect(fromMock).toHaveBeenCalledWith("kill_list_items");
    expect(chain.update).toHaveBeenCalledWith({ completed: true });
    expect(chain.eq).toHaveBeenCalledWith("id", "kill-item-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("updates tasks.completed by id for toggle_task", async () => {
    const chain = makeChain();
    fromMock.mockReturnValue(chain);
    const { toggleItem } = await import("../actions");

    await toggleItem(baseItem({ actionType: "toggle_task", actionRefId: "task-1" }));

    expect(fromMock).toHaveBeenCalledWith("tasks");
    expect(chain.update).toHaveBeenCalledWith({ completed: true });
    expect(chain.eq).toHaveBeenCalledWith("id", "task-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("upserts habit_logs keyed by habit_id + date for toggle_habit", async () => {
    const chain = makeChain();
    fromMock.mockReturnValue(chain);
    const { toggleItem } = await import("../actions");

    await toggleItem(baseItem({ actionType: "toggle_habit", actionRefId: "habit-1", date: "2026-08-10" }));

    expect(fromMock).toHaveBeenCalledWith("habit_logs");
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        habit_id: "habit-1",
        user_id: "user-1",
        date: "2026-08-10",
        completed: true,
      }),
      expect.objectContaining({ onConflict: "habit_id,date" })
    );
  });

  it("upserts adhkar_logs keyed by period + date for toggle_adhkar", async () => {
    const chain = makeChain();
    fromMock.mockReturnValue(chain);
    const { toggleItem } = await import("../actions");

    await toggleItem(baseItem({ actionType: "toggle_adhkar", actionRefId: "morning", date: "2026-08-10" }));

    expect(fromMock).toHaveBeenCalledWith("adhkar_logs");
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        date: "2026-08-10",
        period: "morning",
        completed: true,
      }),
      expect.objectContaining({ onConflict: "user_id,date,period" })
    );
  });

  it("inserts a workout_logs row with source 'scheduled' for toggle_workout", async () => {
    const chain = makeChain();
    fromMock.mockReturnValue(chain);
    const { toggleItem } = await import("../actions");

    await toggleItem(
      baseItem({ actionType: "toggle_workout", actionRefId: "Push", date: "2026-08-10" })
    );

    expect(fromMock).toHaveBeenCalledWith("workout_logs");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        date: "2026-08-10",
        workout_name: "Push",
        source: "scheduled",
      })
    );
  });

  it("throws if no authenticated user is present", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } });
    const { toggleItem } = await import("../actions");

    await expect(toggleItem(baseItem({ actionType: "toggle_prayer" }))).rejects.toThrow();
  });
});

describe("signOut", () => {
  beforeEach(() => {
    signOutMock.mockClear();
    redirectMock.mockClear();
  });

  it("calls supabase auth.signOut and redirects to /login", async () => {
    const { signOut } = await import("../actions");

    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");

    expect(signOutMock).toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });
});
