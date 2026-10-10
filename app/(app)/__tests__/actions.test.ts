import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PriorityItem } from "@/lib/home/types";

function makeChain() {
  const chain: Record<string, unknown> = {};
  chain.upsert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.select = vi.fn(() => chain);
  // markPrayer's own future-date guard (deen/actions.ts) reads the caller's
  // profile timezone via .select(...).eq(...).maybeSingle() before ever
  // reaching .upsert() — needed here so toggleItem's toggle_prayer path
  // (which calls markPrayer) doesn't crash on a chain that never modeled
  // that read. Resolving to no profile row falls back to UTC, which is
  // fine for this file's fixed 2026-08-10 test dates (always in the past
  // relative to whenever this suite actually runs).
  // Deen Mode: this chain also answers getProfile()'s `.maybeSingle()`, and the
  // deen branches of toggleItem refuse unless profiles.deen_mode is literally
  // true -- so this fixture is a deen_mode:true profile (timezone absent -> UTC).
  chain.maybeSingle = vi.fn(async () => ({ data: { deen_mode: true }, error: null }));
  // markPrayerCore (lib/deen/actions-core.ts, L6) selects `id, logged_at`
  // back off its own upsert — `.upsert(...).select(...).single()` — for
  // the MCP write tool's {id, updated_at} contract. This file's own
  // toggle_prayer path goes through the exact same core now.
  chain.single = vi.fn(async () => ({ data: { id: "row-1", logged_at: "2026-08-10T00:00:00.000Z" }, error: null }));
  chain.then = (resolve: (v: { error: null }) => void) => resolve({ error: null });
  return chain as {
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
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

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
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
    cost: null,
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

  it("updates kill_list_items.completed and stamps completed_at by id for toggle_kill_list", async () => {
    const chain = makeChain();
    fromMock.mockReturnValue(chain);
    const { toggleItem } = await import("../actions");

    await toggleItem(baseItem({ actionType: "toggle_kill_list", actionRefId: "kill-item-1" }));

    expect(fromMock).toHaveBeenCalledWith("kill_list_items");
    expect(chain.update).toHaveBeenCalledWith({ completed: true, completed_at: expect.any(String) });
    expect(chain.eq).toHaveBeenCalledWith("id", "kill-item-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("updates tasks.completed and stamps completed_at by id for toggle_task", async () => {
    const chain = makeChain();
    fromMock.mockReturnValue(chain);
    const { toggleItem } = await import("../actions");

    await toggleItem(baseItem({ actionType: "toggle_task", actionRefId: "task-1" }));

    expect(fromMock).toHaveBeenCalledWith("tasks");
    expect(chain.update).toHaveBeenCalledWith({ completed: true, completed_at: expect.any(String) });
    expect(chain.eq).toHaveBeenCalledWith("id", "task-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  describe("delayItem", () => {
    it("moves a task's due_date to the day after item.date (and only if still incomplete)", async () => {
      const chain = makeChain();
      fromMock.mockReturnValue(chain);
      const { delayItem } = await import("../actions");

      const res = await delayItem(baseItem({ actionType: "toggle_task", actionRefId: "task-1", date: "2026-08-31", domain: "school" }));

      expect(res).toEqual({ ok: true });
      expect(fromMock).toHaveBeenCalledWith("tasks");
      expect(chain.update).toHaveBeenCalledWith({ due_date: "2026-09-01" }); // month rollover, calendar arithmetic
      expect(chain.eq).toHaveBeenCalledWith("id", "task-1");
      expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(chain.eq).toHaveBeenCalledWith("completed", false);
    });

    it("moves a kill-list item to tomorrow's first free slot", async () => {
      const chain = makeChain();
      // tomorrow already has positions 0 and 2 taken -> 1 is the free slot
      (chain as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [{ position: 0 }, { position: 2 }], error: null });
      fromMock.mockReturnValue(chain);
      const { delayItem } = await import("../actions");

      const res = await delayItem(baseItem({ actionType: "toggle_kill_list", actionRefId: "k1", date: "2026-08-10", domain: "business" }));

      expect(res).toEqual({ ok: true });
      expect(chain.eq).toHaveBeenCalledWith("date", "2026-08-11");
      expect(chain.update).toHaveBeenCalledWith({ date: "2026-08-11", position: 1 });
      expect(chain.eq).toHaveBeenCalledWith("id", "k1");
    });

    it("refuses (and writes nothing) when tomorrow's kill list is full", async () => {
      const chain = makeChain();
      (chain as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [{ position: 0 }, { position: 1 }, { position: 2 }], error: null });
      fromMock.mockReturnValue(chain);
      const { delayItem } = await import("../actions");

      const res = await delayItem(baseItem({ actionType: "toggle_kill_list", actionRefId: "k1", domain: "business" }));

      expect(res).toEqual({ ok: false, message: "Tomorrow's Kill List is already full" });
      expect(chain.update).not.toHaveBeenCalled();
    });

    it("rejects item types that are tied to their own day/window (prayer, habit, adhkar, fitness)", async () => {
      const { delayItem } = await import("../actions");
      for (const actionType of ["toggle_prayer", "toggle_habit", "toggle_adhkar", "open_fitness"] as const) {
        await expect(delayItem(baseItem({ actionType }))).rejects.toThrow(/cannot be delayed/);
      }
    });
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

  // Home's fitness row navigates (next-actions.tsx renders a Link, not a
  // checkbox) and must never toggle — throwing rather than silently
  // no-opping means a future change that accidentally routes it into the
  // toggle path fails loudly instead of half-working (docs/superpowers/
  // specs/2026-08-23-home-fitness-row.md).
  it("throws for open_fitness rather than silently no-opping", async () => {
    const { toggleItem } = await import("../actions");

    await expect(toggleItem(baseItem({ actionType: "open_fitness", actionRefId: "micro" }))).rejects.toThrow();
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

describe("saveWeeklyGoal", () => {
  function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "upsert", "update"]) chain[method] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => resolvedValue);
    chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
    return chain as {
      select: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      maybeSingle: ReturnType<typeof vi.fn>;
    };
  }

  beforeEach(() => {
    fromMock.mockReset();
    getClaimsMock.mockClear();
  });

  // 2026-08-13 is a Thursday in the week starting Sunday 2026-08-09.
  const NOW = new Date("2026-08-13T18:00:00Z");

  it("upserts this week's goal keyed by (user_id, week_start_date, domain)", async () => {
    const profileChain = makeChain({ data: { timezone: "America/Chicago", deen_mode: true }, error: null });
    const weeklyGoalsChain = makeChain({ data: null, error: null }); // no prior week row
    fromMock.mockImplementation((table: string) => (table === "profiles" ? profileChain : weeklyGoalsChain));
    const { saveWeeklyGoal } = await import("../actions");

    await saveWeeklyGoal("deen", "Read more Qur'an", ["Finish Juz 5"], 50, NOW);

    expect(weeklyGoalsChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        week_start_date: "2026-08-09",
        domain: "deen",
        headline: "Read more Qur'an",
        milestones: ["Finish Juz 5"],
        quran_page_target: 50,
      }),
      expect.objectContaining({ onConflict: "user_id,week_start_date,domain" })
    );
  });

  it("locks last week's row if it exists and isn't already locked", async () => {
    const profileChain = makeChain({ data: { timezone: "America/Chicago" }, error: null });
    const weeklyGoalsChain = makeChain({ data: { id: "prev-1", locked: false }, error: null });
    fromMock.mockImplementation((table: string) => (table === "profiles" ? profileChain : weeklyGoalsChain));
    const { saveWeeklyGoal } = await import("../actions");

    await saveWeeklyGoal("business", "Close 3 deals", [], undefined, NOW);

    expect(weeklyGoalsChain.update).toHaveBeenCalledWith({ locked: true });
  });

  // IA-P1b: the Business weekly_goal widget saves through this action too; the Business screen
  // is served at /business or /work/<tab>, so a business save must refresh both.
  it("a business save revalidates /, /calendar and the Business screens (/business + the work-tab page); a deen save does not touch them", async () => {
    const profileChain = makeChain({ data: { timezone: "America/Chicago" }, error: null });
    const weeklyGoalsChain = makeChain({ data: null, error: null });
    fromMock.mockImplementation((table: string) => (table === "profiles" ? profileChain : weeklyGoalsChain));
    const { saveWeeklyGoal } = await import("../actions");

    revalidatePathMock.mockClear();
    await saveWeeklyGoal("business", "Close 3 deals", [], undefined, NOW);
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(revalidatePathMock).toHaveBeenCalledWith("/calendar");
    expect(revalidatePathMock).toHaveBeenCalledWith("/business");
    expect(revalidatePathMock).toHaveBeenCalledWith("/work/[subdomain]", "page");

    revalidatePathMock.mockClear();
    await saveWeeklyGoal("deen", "Read", [], 5, NOW);
    expect(revalidatePathMock).not.toHaveBeenCalledWith("/business");
  });

  it("does not error when no prior week exists (first-ever week)", async () => {
    const profileChain = makeChain({ data: { timezone: "America/Chicago" }, error: null });
    const weeklyGoalsChain = makeChain({ data: null, error: null });
    fromMock.mockImplementation((table: string) => (table === "profiles" ? profileChain : weeklyGoalsChain));
    const { saveWeeklyGoal } = await import("../actions");

    await expect(saveWeeklyGoal("deen", "First week goal", [], undefined, NOW)).resolves.not.toThrow();
    expect(weeklyGoalsChain.update).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  beforeEach(() => {
    signOutMock.mockClear();
    redirectMock.mockClear();
    revalidatePathMock.mockClear();
  });

  it("calls supabase auth.signOut and redirects to /login", async () => {
    const { signOut } = await import("../actions");

    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");

    expect(signOutMock).toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  // Privacy fix (Opus Lead ruling, 2026-09-18), not just staleness: this is
  // the moment a departing user's cached content should be actively
  // discarded, not left for whoever uses this device next. Without this,
  // the client Router Cache can still hold THIS user's rendered "/" after
  // sign-out -- and if a different user then signs in on the same device,
  // signIn's own revalidate (app/login/actions.ts) only proves a stale
  // entry gets busted on the way IN; this proves the departing side does
  // its part too, so neither leg of a shared-device handoff depends on the
  // other alone.
  it("discards previously cached page content on sign-out, before redirecting", async () => {
    const { signOut } = await import("../actions");

    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");

    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
  });
});

describe("Faith Mode OFF refuses the deen branches (data untouched)", () => {
  function offChain(deenMode: boolean | null) {
    const chain = makeChain();
    chain.maybeSingle = vi.fn(async () => ({ data: deenMode === null ? null : { deen_mode: deenMode, timezone: "UTC" }, error: null }));
    return chain;
  }

  beforeEach(() => {
    fromMock.mockReset();
  });

  for (const off of [false, null]) {
    const label = off === null ? "no profile row" : "deen_mode false";
    it(`toggle_prayer is a no-op with ${label}`, async () => {
      const chain = offChain(off);
      fromMock.mockReturnValue(chain);
      const { toggleItem } = await import("../actions");
      await toggleItem(baseItem({ actionType: "toggle_prayer", actionRefId: "fajr" }));
      expect(chain.upsert).not.toHaveBeenCalled();
      expect(fromMock).not.toHaveBeenCalledWith("prayers");
    });

    it(`toggle_adhkar is a no-op with ${label}`, async () => {
      const chain = offChain(off);
      fromMock.mockReturnValue(chain);
      const { toggleItem } = await import("../actions");
      await toggleItem(baseItem({ actionType: "toggle_adhkar", actionRefId: "morning" }));
      expect(fromMock).not.toHaveBeenCalledWith("adhkar_logs");
      expect(chain.upsert).not.toHaveBeenCalled();
    });

    it(`saveWeeklyGoal("deen") writes nothing with ${label}, but business still saves`, async () => {
      const chain = offChain(off);
      fromMock.mockReturnValue(chain);
      const { saveWeeklyGoal } = await import("../actions");
      await saveWeeklyGoal("deen", "h", ["m"], 10, new Date("2026-08-13T18:00:00Z"));
      expect(chain.upsert).not.toHaveBeenCalled();
      expect(chain.update).not.toHaveBeenCalled();
      await saveWeeklyGoal("business", "h", ["m"], undefined, new Date("2026-08-13T18:00:00Z"));
      expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ domain: "business" }), expect.anything());
    });
  }

  it("toggle_task is unaffected when Faith Mode is off", async () => {
    const chain = offChain(false);
    fromMock.mockReturnValue(chain);
    const { toggleItem } = await import("../actions");
    await toggleItem(baseItem({ actionType: "toggle_task", actionRefId: "t1", domain: "school" }));
    expect(fromMock).toHaveBeenCalledWith("tasks");
  });
});
