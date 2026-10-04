import { beforeEach, describe, expect, it, vi } from "vitest";

// Deen Mode OFF must not read prayers and must not count them: with five
// phantom "pending" prayers in every day's denominator a fully-done day would
// read 4/9 instead of 100%.
function makeChain(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "lte"]) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: { data: unknown }) => void) => resolve({ data });
  return chain;
}

let tables: Record<string, unknown>;
const fromMock = vi.fn((table: string) => makeChain(tables[table] ?? []));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: fromMock })) }));

const NOW = new Date("2026-08-10T18:00:00Z");

describe("getWeeklyCompletion -- Deen Mode", () => {
  beforeEach(() => {
    fromMock.mockClear();
    tables = {
      kill_list_items: [{ date: "2026-08-10", completed: true }],
      tasks: [],
      workout_schedule: [],
      workout_sessions: [],
      prayers: [{ date: "2026-08-10", prayer_name: "fajr", status: "on_time" }],
    };
  });

  it("OFF: never queries prayers; a fully-done day is 100% (no phantom denominator)", async () => {
    const { getWeeklyCompletion } = await import("../get-weekly-completion");
    const result = await getWeeklyCompletion("u1", NOW, { timezone: "UTC", deen_mode: false });
    expect(fromMock).not.toHaveBeenCalledWith("prayers");
    expect(result.weeklyCompletionPct.at(-1)).toBe(100);
  });

  it("fails closed with no profile", async () => {
    const { getWeeklyCompletion } = await import("../get-weekly-completion");
    await getWeeklyCompletion("u1", NOW, null);
    expect(fromMock).not.toHaveBeenCalledWith("prayers");
  });

  it("positive control: ON queries prayers and counts them (1 of 6 done by the kill list + fajr = 2/6)", async () => {
    const { getWeeklyCompletion } = await import("../get-weekly-completion");
    const result = await getWeeklyCompletion("u1", NOW, { timezone: "UTC", deen_mode: true });
    expect(fromMock).toHaveBeenCalledWith("prayers");
    expect(result.weeklyCompletionPct.at(-1)).toBe(33);
  });
});
