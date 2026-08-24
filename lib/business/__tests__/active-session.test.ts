import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingleMock = vi.fn();
const isMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const eqMock = vi.fn(() => ({ is: isMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

describe("getActiveWorkSession", () => {
  beforeEach(() => {
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    isMock.mockClear();
    maybeSingleMock.mockReset();
    vi.resetModules();
  });

  it("returns null when there's no active session", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const { getActiveWorkSession } = await import("../active-session");

    const result = await getActiveWorkSession("user-1");

    expect(fromMock).toHaveBeenCalledWith("work_sessions");
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(isMock).toHaveBeenCalledWith("ended_at", null);
    expect(result).toBeNull();
  });

  it("maps an active session row to { id, startedAt, kind }", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { id: "session-1", started_at: "2026-08-17T17:00:00.000Z", kind: "deep_study" },
      error: null,
    });
    const { getActiveWorkSession } = await import("../active-session");

    const result = await getActiveWorkSession("user-1");

    expect(result).toEqual({ id: "session-1", startedAt: "2026-08-17T17:00:00.000Z", kind: "deep_study" });
  });
});
