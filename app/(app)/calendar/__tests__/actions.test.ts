import { beforeEach, describe, expect, it, vi } from "vitest";

// Deen Mode OFF: getWeekCalendar must not read quran_sessions, must not return
// the deen goal even if the row exists, and flags deenMode:false for the view.
function makeChain(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "lte", "not", "is", "order"]) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data, error: null });
  return chain;
}

let profile: Record<string, unknown> | null;
const tables: Record<string, unknown> = {
  weekly_goals: [
    { domain: "deen", headline: "Kahf", milestones: [], quran_page_target: 20 },
    { domain: "business", headline: "Ship", milestones: [], quran_page_target: null },
  ],
  quran_sessions: [{ pages_read: 7 }],
};
const fromMock = vi.fn((t: string) => makeChain(tables[t] ?? []));

vi.mock("@/lib/supabase/auth", () => ({
  requireUser: vi.fn(async () => ({ supabase: { from: fromMock }, userId: "u1" })),
  getProfile: vi.fn(async () => profile),
}));
vi.mock("@/lib/domains/get-user-domains", () => ({ getUserDomains: vi.fn(async () => ({ mode: "legacy" })) }));
vi.mock("@/lib/tasks/schedule-cancellations", () => ({
  getCancelledDatesByEvent: vi.fn(async () => new Map()),
  isOccurrenceCancelled: vi.fn(() => false),
}));

describe("getWeekCalendar -- Faith Mode", () => {
  beforeEach(() => fromMock.mockClear());

  it("OFF: no quran read, no deen goal, deenMode false (business untouched)", async () => {
    profile = { timezone: "UTC", deen_mode: false };
    const { getWeekCalendar } = await import("../actions");
    const data = await getWeekCalendar();
    expect(fromMock).not.toHaveBeenCalledWith("quran_sessions");
    expect(data.deen).toBeNull();
    expect(data.business?.headline).toBe("Ship");
    expect(data.deenMode).toBe(false);
  });

  it("positive control: ON reads quran sessions and returns the deen goal with pages", async () => {
    profile = { timezone: "UTC", deen_mode: true };
    const { getWeekCalendar } = await import("../actions");
    const data = await getWeekCalendar();
    expect(fromMock).toHaveBeenCalledWith("quran_sessions");
    expect(data.deen).toMatchObject({ headline: "Kahf", quranPages: 7, quranTarget: null });
    expect(data.deenMode).toBe(true);
  });
});
