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
const getClaimsMock = vi.fn(async () => ({
  data: { claims: { sub: "user-1" } } as { claims: { sub: string } } | null,
  error: null as { message: string } | null,
}));
const signOutMock = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: getClaimsMock, signOut: signOutMock },
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
    windowEndAt: null,
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
    getClaimsMock.mockClear();
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

  // toggle_workout is deleted, not repointed (Fitness redesign Phase 7,
  // 2026-08-20): it was a bare one-tap workout completion with no numbers
  // shown, which spec §2.1 forbids for the new confirm flow regardless of
  // which table it wrote to. This test asserted the old contract and is
  // removed along with the code it tested, not because it started failing.

  it("throws if no authenticated user is present", async () => {
    getClaimsMock.mockResolvedValueOnce({ data: null, error: null });
    const { toggleItem } = await import("../actions");

    await expect(toggleItem(baseItem({ actionType: "toggle_prayer" }))).rejects.toThrow();
  });
});

describe("markNotificationReadForNow", () => {
  beforeEach(() => {
    fromMock.mockReset();
    getClaimsMock.mockClear();
  });

  function makeTableAwareFrom(responses: Record<string, { data: unknown; error: unknown }>) {
    return (table: string) => {
      const resolved = responses[table] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "upsert"]) chain[method] = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => resolved);
      chain.then = (resolve: (v: typeof resolved) => void) => resolve(resolved);
      return chain;
    };
  }

  it("derives the date from the user's own profile timezone, not UTC, then writes it", async () => {
    fromMock.mockImplementation(
      makeTableAwareFrom({
        profiles: { data: { user_id: "user-1", timezone: "America/Chicago" }, error: null },
        notification_reads: { data: null, error: null },
      })
    );
    const { markNotificationReadForNow } = await import("../actions");

    // 02:30Z on the 20th is still 21:30 CDT on the 19th.
    await markNotificationReadForNow("prayer-fajr", "2026-08-20T02:30:00.000Z");

    expect(fromMock).toHaveBeenCalledWith("notification_reads");
    const notificationReadsCall = fromMock.mock.results.find(
      (_, i) => fromMock.mock.calls[i][0] === "notification_reads"
    );
    const chain = notificationReadsCall!.value as { upsert: ReturnType<typeof vi.fn> };
    expect(chain.upsert).toHaveBeenCalledWith(
      { user_id: "user-1", notification_key: "prayer-fajr", date: "2026-08-19" },
      { onConflict: "user_id,notification_key,date", ignoreDuplicates: true }
    );
  });

  it("throws if no authenticated user is present", async () => {
    getClaimsMock.mockResolvedValueOnce({ data: null, error: null });
    const { markNotificationReadForNow } = await import("../actions");

    await expect(markNotificationReadForNow("prayer-fajr", "2026-08-20T02:30:00.000Z")).rejects.toThrow();
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
