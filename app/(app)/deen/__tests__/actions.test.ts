import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  const calls: { method: string; args: unknown[] }[] = [];
  for (const method of ["select", "eq", "order", "limit", "upsert", "update", "insert", "delete"]) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    });
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  chain.__calls = calls;
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    __calls: { method: string; args: unknown[] }[];
  };
}

const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: getClaimsMock },
    from: fromMock,
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("Deen actions", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
  });

  it("markPrayer upserts into prayers keyed on (user_id, date, prayer_name)", async () => {
    const prayersChain = makeChain();
    fromImpl = () => prayersChain;
    const { markPrayer } = await import("../actions");

    await markPrayer("2026-08-10", "dhuhr", "on_time");

    expect(fromMock).toHaveBeenCalledWith("prayers");
    expect(prayersChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        date: "2026-08-10",
        prayer_name: "dhuhr",
        status: "on_time",
      }),
      expect.objectContaining({ onConflict: "user_id,date,prayer_name" })
    );
  });

  it("unmarkPrayer deletes the stored row for (user_id, date, prayer_name)", async () => {
    const prayersChain = makeChain();
    fromImpl = () => prayersChain;
    const { unmarkPrayer } = await import("../actions");

    await unmarkPrayer("2026-08-10", "fajr");

    expect(fromMock).toHaveBeenCalledWith("prayers");
    expect(prayersChain.delete).toHaveBeenCalled();
    expect(prayersChain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(prayersChain.eq).toHaveBeenCalledWith("date", "2026-08-10");
    expect(prayersChain.eq).toHaveBeenCalledWith("prayer_name", "fajr");
  });

  it("writes prayer_name 'dhuhr' (not a separate 'jummah' value) even on a Friday", async () => {
    const prayersChain = makeChain();
    fromImpl = () => prayersChain;
    const { markPrayer } = await import("../actions");

    // 2026-08-14 is a Friday.
    await markPrayer("2026-08-14", "dhuhr", "on_time");

    expect(prayersChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ prayer_name: "dhuhr" }),
      expect.anything()
    );
  });

  it("adjustQadaBacklog decrements profiles.qada_owed", async () => {
    const profilesChain = makeChain({ data: { qada_owed: 5 }, error: null });
    fromImpl = () => profilesChain;
    const { adjustQadaBacklog } = await import("../actions");

    await adjustQadaBacklog(-1);

    expect(profilesChain.update).toHaveBeenCalledWith({ qada_owed: 4 });
  });

  it("adjustQadaBacklog floors at 0, never going negative", async () => {
    const profilesChain = makeChain({ data: { qada_owed: 0 }, error: null });
    fromImpl = () => profilesChain;
    const { adjustQadaBacklog } = await import("../actions");

    await adjustQadaBacklog(-1);

    expect(profilesChain.update).toHaveBeenCalledWith({ qada_owed: 0 });
  });

  it("toggleAdhkar flips completed from false to true", async () => {
    const adhkarChain = makeChain({ data: { completed: false }, error: null });
    fromImpl = () => adhkarChain;
    const { toggleAdhkar } = await import("../actions");

    await toggleAdhkar("2026-08-10", "morning");

    expect(adhkarChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ period: "morning", date: "2026-08-10", completed: true }),
      expect.objectContaining({ onConflict: "user_id,date,period" })
    );
  });

  it("toggleAdhkar flips completed from true to false", async () => {
    const adhkarChain = makeChain({ data: { completed: true }, error: null });
    fromImpl = () => adhkarChain;
    const { toggleAdhkar } = await import("../actions");

    await toggleAdhkar("2026-08-10", "evening");

    expect(adhkarChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ completed: false }),
      expect.anything()
    );
  });

  it("setTravelingMode updates profiles.traveling_mode", async () => {
    const profilesChain = makeChain();
    fromImpl = () => profilesChain;
    const { setTravelingMode } = await import("../actions");

    await setTravelingMode(true);

    expect(profilesChain.update).toHaveBeenCalledWith({ traveling_mode: true });
  });

  it("logQuranSession inserts pages/surah/juz", async () => {
    const chains: Record<string, ReturnType<typeof makeChain>> = {
      profiles: makeChain({ data: { timezone: "America/Chicago" }, error: null }),
      quran_sessions: makeChain(),
    };
    fromImpl = (table) => chains[table];
    const { logQuranSession } = await import("../actions");

    await logQuranSession(5, "Al-Baqarah", 2);

    expect(chains.quran_sessions.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        pages_read: 5,
        surah: "Al-Baqarah",
        juz: 2,
      })
    );
  });

  it("logReflectionEntry inserts a tally row for today with the given tier", async () => {
    const chains: Record<string, ReturnType<typeof makeChain>> = {
      profiles: makeChain({ data: { timezone: "America/Chicago" }, error: null }),
      reflection_entries: makeChain(),
    };
    fromImpl = (table) => chains[table];
    const { logReflectionEntry } = await import("../actions");

    await logReflectionEntry(2);

    expect(chains.reflection_entries.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        tier: 2,
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })
    );
  });

  it("decrementReflectionEntry deletes today's most recent entry of that tier", async () => {
    const chains: Record<string, ReturnType<typeof makeChain>> = {
      profiles: makeChain({ data: { timezone: "America/Chicago" }, error: null }),
      reflection_entries: makeChain({ data: { id: "entry-1" }, error: null }),
    };
    fromImpl = (table) => chains[table];
    const { decrementReflectionEntry } = await import("../actions");

    await decrementReflectionEntry(2);

    expect(chains.reflection_entries.delete).toHaveBeenCalled();
    expect(chains.reflection_entries.eq).toHaveBeenCalledWith("id", "entry-1");
  });

  it("decrementReflectionEntry no-ops when there's nothing to decrement today", async () => {
    const chains: Record<string, ReturnType<typeof makeChain>> = {
      profiles: makeChain({ data: { timezone: "America/Chicago" }, error: null }),
      reflection_entries: makeChain({ data: null, error: null }),
    };
    fromImpl = (table) => chains[table];
    const { decrementReflectionEntry } = await import("../actions");

    await expect(decrementReflectionEntry(1)).resolves.not.toThrow();
    expect(chains.reflection_entries.delete).not.toHaveBeenCalled();
  });

  it("createDeenHabit inserts with committed_date = today and returns the new id", async () => {
    const chain = makeChain({ data: { id: "habit-1" }, error: null });
    fromImpl = () => chain;
    const { createDeenHabit } = await import("../actions");

    const result = await createDeenHabit("Read one page of tafsir");

    expect(fromMock).toHaveBeenCalledWith("deen_habits");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        name: "Read one page of tafsir",
        committed_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        anchor_cue: null,
      })
    );
    expect(result).toEqual({ id: "habit-1" });
  });

  it("createDeenHabit stores a trimmed anchor cue when given one", async () => {
    const chain = makeChain({ data: { id: "habit-2" }, error: null });
    fromImpl = () => chain;
    const { createDeenHabit } = await import("../actions");

    await createDeenHabit("Pray Isha", "  Maghrib  ");

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ anchor_cue: "Maghrib" })
    );
  });

  it("createDeenHabit normalizes a blank anchor cue to null, not an empty string", async () => {
    const chain = makeChain({ data: { id: "habit-3" }, error: null });
    fromImpl = () => chain;
    const { createDeenHabit } = await import("../actions");

    await createDeenHabit("Pray Isha", "   ");

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ anchor_cue: null })
    );
  });

  it("toggleDeenHabitLog upserts keyed on (habit_id, date)", async () => {
    const chain = makeChain({ data: { completed: false }, error: null });
    fromImpl = () => chain;
    const { toggleDeenHabitLog } = await import("../actions");

    await toggleDeenHabitLog("habit-1", "2026-08-10");

    expect(fromMock).toHaveBeenCalledWith("deen_habit_logs");
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

  it("setWeeklyFocus upserts deen_weekly_focus keyed on (user_id, week_start_date)", async () => {
    const chains: Record<string, ReturnType<typeof makeChain>> = {
      profiles: makeChain({ data: { timezone: "America/Chicago" }, error: null }),
      deen_weekly_focus: makeChain(),
    };
    fromImpl = (table) => chains[table];
    const { setWeeklyFocus } = await import("../actions");

    await setWeeklyFocus("habit-1");

    expect(chains.deen_weekly_focus.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        habit_id: "habit-1",
        week_start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
      expect.objectContaining({ onConflict: "user_id,week_start_date" })
    );
  });
});
