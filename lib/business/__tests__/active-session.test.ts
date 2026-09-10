import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingleMock = vi.fn();
// .is() is now followed by a second .eq("counts_toward_hours", true) — the
// deep-work-class scope added when 'learn' became a storable kind. The chain
// stub has to allow eq-after-is, and the assertion below checks the filter is
// actually applied rather than merely tolerated.
const countsEqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const isMock = vi.fn(() => ({ eq: countsEqMock, maybeSingle: maybeSingleMock }));
const eqMock = vi.fn(() => ({ is: isMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn((_table?: string) => ({ select: selectMock }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

describe("getActiveWorkSession", () => {
  beforeEach(() => {
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    isMock.mockClear();
    countsEqMock.mockClear();
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
    // Load-bearing: without this filter an active retrieval session would be
    // returned as the active Lock-In session (see active-session.ts).
    expect(countsEqMock).toHaveBeenCalledWith("counts_toward_hours", true);
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

// getActiveWorkSessionDetail (146): the objectives-join half is exercised
// exhaustively in isolation in session-objectives.test.ts
// (loadSessionObjectivesCore, which this function delegates to) — not
// re-derived here with a second multi-table fake for the same coverage.
// This covers only what's specific to this function: the null-session
// short-circuit (no objectives query at all) and that goal_minutes/
// objectives ride along on the happy path.
describe("getActiveWorkSessionDetail", () => {
  it("returns null and never queries objectives when there's no active session", async () => {
    fromMock.mockClear();
    maybeSingleMock.mockReset();
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    vi.resetModules();
    const { getActiveWorkSessionDetail } = await import("../active-session");

    const result = await getActiveWorkSessionDetail("user-1");

    expect(result).toBeNull();
    // Only the work_sessions lookup — never a second table for objectives.
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("includes goal_minutes and the joined objectives when a session is active", async () => {
    fromMock.mockClear();
    maybeSingleMock.mockReset();
    maybeSingleMock.mockResolvedValue({
      data: { id: "session-1", started_at: "2026-08-17T17:00:00.000Z", kind: "deep_work", goal_minutes: 30 },
      error: null,
    });
    // A second, permissive chain for whatever loadSessionObjectivesCore
    // queries next (work_session_objectives, then kill_list_items/tasks) —
    // empty results throughout, since this test only checks the shape
    // getActiveWorkSessionDetail itself assembles, not the join's own logic.
    const objectivesChain = { select: vi.fn(() => objectivesChain), eq: vi.fn(() => objectivesChain), order: vi.fn(() => objectivesChain), then: (r: (v: { data: unknown[]; error: null }) => void) => r({ data: [], error: null }) };
    // Cast needed: fromMock's declared type was inferred from its single
    // fixed-shape usage above (getActiveWorkSession's own tests) — this
    // override intentionally returns a DIFFERENT shape per table, which no
    // amount of retyping the original declaration cleanly expresses without
    // loosening it for every other test in this file too.
    (fromMock as unknown as { mockImplementation(fn: (table: string) => unknown): void }).mockImplementation((table: string) =>
      table === "work_sessions" ? { select: selectMock } : objectivesChain
    );
    vi.resetModules();
    const { getActiveWorkSessionDetail } = await import("../active-session");

    const result = await getActiveWorkSessionDetail("user-1");

    expect(result).toEqual({
      id: "session-1",
      startedAt: "2026-08-17T17:00:00.000Z",
      kind: "deep_work",
      goalMinutes: 30,
      objectives: [],
    });
  });
});
