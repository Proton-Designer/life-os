import { describe, it, expect, vi, beforeEach } from "vitest";
import { CheckinSchedulerLoader } from "../checkin-scheduler-loader";

const getAuthedUserMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  getAuthedUser: () => getAuthedUserMock(),
}));

function makeChain(resolvedValue: { data: unknown; error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "lt"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain;
}

let profileResult: { data: unknown; error: null };
let checkinsResult: { data: unknown; error: null };
const fromMock = vi.fn((table: string) => {
  if (table === "profiles") return makeChain(profileResult);
  return makeChain(checkinsResult);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

describe("CheckinSchedulerLoader", () => {
  beforeEach(() => {
    getAuthedUserMock.mockReset();
    fromMock.mockClear();
    checkinsResult = { data: [], error: null };
  });

  it("returns null when there's no authenticated user", async () => {
    getAuthedUserMock.mockResolvedValue(null);
    profileResult = { data: null, error: null };

    const result = await CheckinSchedulerLoader();

    expect(result).toBeNull();
  });

  it("returns null when the user has no profile row yet", async () => {
    getAuthedUserMock.mockResolvedValue({ id: "user-1" });
    profileResult = { data: null, error: null };

    const result = await CheckinSchedulerLoader();

    expect(result).toBeNull();
  });

  it("passes correctly computed props to CheckinScheduler when a profile exists", async () => {
    getAuthedUserMock.mockResolvedValue({ id: "user-1" });
    profileResult = {
      data: {
        timezone: "America/Chicago",
        checkin_window_start: "08:00:00",
        checkin_window_end: "22:00:00",
        checkin_interval_minutes: 120,
        paused_date: null,
      },
      error: null,
    };
    checkinsResult = { data: [{ checkin_time: "2026-08-11T14:00:00+00:00" }], error: null };

    const element = await CheckinSchedulerLoader();

    expect(element).not.toBeNull();
    expect((element as React.ReactElement).props).toMatchObject({
      timezone: "America/Chicago",
      windowStart: "08:00",
      windowEnd: "22:00",
      intervalMinutes: 120,
      pausedDate: null,
      answeredSlotTimesIso: ["2026-08-11T14:00:00+00:00"],
    });
  });
});
