import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  const calls: { method: string; args: unknown[] }[] = [];
  for (const method of ["select", "eq", "order", "upsert", "update", "insert"]) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    });
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  chain.__calls = calls;
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    __calls: { method: string; args: unknown[] }[];
  };
}

const getUserMock = vi.fn(async () => ({ data: { user: { id: "user-1" } } }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("Deen actions", () => {
  beforeEach(() => {
    getUserMock.mockClear();
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
});
