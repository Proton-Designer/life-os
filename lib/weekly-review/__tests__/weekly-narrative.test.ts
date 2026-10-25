import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const gatewayChatMock = vi.fn();
vi.mock("@/lib/ai/gateway", () => ({
  gatewayChat: (...args: unknown[]) => gatewayChatMock(...args),
}));

const getHoursByKindForRangeMock = vi.fn();
const getEndedRecallMinutesForRangeMock = vi.fn();
vi.mock("@/lib/evening-close/hours-today", () => ({
  getHoursByKindForRange: (...args: unknown[]) => getHoursByKindForRangeMock(...args),
  getEndedRecallMinutesForRange: (...args: unknown[]) => getEndedRecallMinutesForRangeMock(...args),
}));

const getDistractionParetoMock = vi.fn();
vi.mock("../pareto", () => ({
  getDistractionPareto: (...args: unknown[]) => getDistractionParetoMock(...args),
}));

const getHabitWeeklySummariesMock = vi.fn();
vi.mock("../habit-summary", () => ({
  getHabitWeeklySummaries: (...args: unknown[]) => getHabitWeeklySummariesMock(...args),
}));

const {
  computeWeeklyNarrativeInputs,
  normalizeNarrativeText,
  generateWeeklyNarrative,
  dispatchCollegeOsWeeklyNarratives,
  getCollegeOsWeeklyNarrative,
} = await import("../weekly-narrative");

beforeEach(() => {
  gatewayChatMock.mockReset();
  getHoursByKindForRangeMock.mockReset().mockResolvedValue({ totalMinutes: 0, byKind: {} });
  getEndedRecallMinutesForRangeMock.mockReset().mockResolvedValue(0);
  getDistractionParetoMock.mockReset().mockResolvedValue([]);
  getHabitWeeklySummariesMock.mockReset().mockResolvedValue([]);
});

describe("normalizeNarrativeText()", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeNarrativeText("  A real week.  \n")).toBe("A real week.");
  });

  it("returns empty string for all-blank input, never throws", () => {
    expect(normalizeNarrativeText("\n\n  \n")).toBe("");
  });
});

describe("computeWeeklyNarrativeInputs()", () => {
  const fakeClient = {} as unknown as SupabaseClient;

  it("maps each reader's output onto the narrative inputs shape, reusing the SAME readers the Weekly Review page itself calls", async () => {
    getHoursByKindForRangeMock.mockResolvedValue({ totalMinutes: 150, byKind: { deep_work: 90, deep_study: 60 } });
    getEndedRecallMinutesForRangeMock.mockResolvedValue(45);
    getDistractionParetoMock.mockResolvedValue([
      { label: "Phone", count: 5 },
      { label: "Noise", count: 2 },
    ]);
    getHabitWeeklySummariesMock.mockResolvedValue([
      { id: "h1", identityStatement: "a reader", isNew: false, score: 0.8, votesThisWeek: 3 },
      { id: "h2", identityStatement: "an early riser", isNew: false, score: 0.2, votesThisWeek: 0 },
    ]);

    const result = await computeWeeklyNarrativeInputs(fakeClient, "u1", "2026-09-07", "2026-09-14", "2026-09-14", "America/Chicago");

    expect(result).toEqual({
      deepWorkMinutes: 90,
      deepStudyMinutes: 60,
      recallMinutes: 45,
      topDistraction: { label: "Phone", count: 5 },
      habitsVotedCount: 1,
      habitsTotalCount: 2,
    });
  });

  it("missing kinds in byKind default to 0, not undefined", async () => {
    getHoursByKindForRangeMock.mockResolvedValue({ totalMinutes: 0, byKind: {} });
    const result = await computeWeeklyNarrativeInputs(fakeClient, "u1", "2026-09-07", "2026-09-14", "2026-09-14", "UTC");
    expect(result.deepWorkMinutes).toBe(0);
    expect(result.deepStudyMinutes).toBe(0);
  });

  it("no distractions this pareto -> topDistraction is null, not a fabricated zero-count entry", async () => {
    getDistractionParetoMock.mockResolvedValue([]);
    const result = await computeWeeklyNarrativeInputs(fakeClient, "u1", "2026-09-07", "2026-09-14", "2026-09-14", "UTC");
    expect(result.topDistraction).toBeNull();
  });

  it("passes the week-scoped ISO instants (not the raw date strings) to the hours/recall readers", async () => {
    await computeWeeklyNarrativeInputs(fakeClient, "u1", "2026-09-07", "2026-09-14", "2026-09-14", "America/Chicago");
    const hoursCall = getHoursByKindForRangeMock.mock.calls[0];
    expect(hoursCall[0]).toBe(fakeClient);
    expect(hoursCall[1]).toBe("u1");
    expect(hoursCall[2]).toBe("2026-09-07T05:00:00.000Z"); // week start 00:00 CDT
    expect(hoursCall[3]).toBe("2026-09-14T05:00:00.000Z"); // week end 00:00 CDT
  });
});

describe("generateWeeklyNarrative()", () => {
  const INPUTS = { deepWorkMinutes: 60, deepStudyMinutes: 30, recallMinutes: 15, topDistraction: null, habitsVotedCount: 1, habitsTotalCount: 2 };

  it("calls gatewayChat with provider/tier OMITTED (resolves the user's own saved preference), feature 'weekly_narrative'", async () => {
    gatewayChatMock.mockResolvedValue({ ok: true, content: "A solid week overall.", keySource: "user" });
    const fakeClient = {} as unknown as SupabaseClient;
    const result = await generateWeeklyNarrative(fakeClient, "user-1", INPUTS);

    expect(result).toEqual({ ok: true, narrativeText: "A solid week overall.", provider: "user", model: "" });
    const call = gatewayChatMock.mock.calls[0];
    expect(call[0]).toBe(fakeClient);
    expect(call[1]).toBe("user-1");
    expect(call[2]).toBe("weekly_narrative");
    expect(call[4]).not.toHaveProperty("provider");
    expect(call[4]).not.toHaveProperty("tier");
  });

  it("gatewayChat ok:false (no key, cap hit, provider failure) surfaces as ok:false with its own message -- never throws", async () => {
    gatewayChatMock.mockResolvedValue({ ok: false, message: "AI features aren't enabled for this account." });
    const result = await generateWeeklyNarrative({} as unknown as SupabaseClient, "user-1", INPUTS);
    expect(result).toEqual({ ok: false, reason: "AI features aren't enabled for this account." });
  });

  it("empty/unusable content after normalization is treated as a failure, not a blank narrative", async () => {
    gatewayChatMock.mockResolvedValue({ ok: true, content: "\n\n  \n" });
    const result = await generateWeeklyNarrative({} as unknown as SupabaseClient, "user-1", INPUTS);
    expect(result.ok).toBe(false);
  });
});

describe("dispatchCollegeOsWeeklyNarratives()", () => {
  // 2026-09-13 is a Sunday. America/Chicago is UTC-5 in September. Window is [04:00, 09:00) local.
  const AT_0400_LOCAL = new Date("2026-09-13T09:00:00.000Z");
  const AT_0359_LOCAL = new Date("2026-09-13T08:59:00.000Z");
  const AT_0859_LOCAL = new Date("2026-09-13T13:59:00.000Z");
  const AT_0900_LOCAL = new Date("2026-09-13T14:00:00.000Z");
  const A_TUESDAY = new Date("2026-09-15T09:00:00.000Z"); // NOT this user's week-start day

  function makeClient(opts: { profiles?: { user_id: string; timezone: string | null }[]; claimedUsers?: Set<string> } = {}) {
    const insertCalls: Record<string, unknown>[] = [];
    const updateCalls: Record<string, unknown>[] = [];
    const deleteCalls: Record<string, unknown>[] = [];
    const claimed = new Set(opts.claimedUsers ?? []);

    const from = vi.fn((table: string) => {
      const eqArgs: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn((col: string, val: unknown) => {
        eqArgs[col] = val;
        return chain;
      });
      chain.gte = vi.fn(() => chain);
      chain.lt = vi.fn(() => chain);
      chain.in = vi.fn(() => chain);
      chain.is = vi.fn(() => chain);
      chain.then = (resolve: (v: { data?: unknown; error: null }) => void) => {
        if (table === "profiles") return resolve({ data: opts.profiles ?? [], error: null });
        resolve({ data: null, error: null });
      };
      chain.insert = vi.fn((row: Record<string, unknown>) => {
        insertCalls.push(row);
        const userId = row.user_id as string;
        if (claimed.has(userId)) return Promise.resolve({ error: { code: "23505" } });
        claimed.add(userId);
        return Promise.resolve({ error: null });
      });
      chain.update = vi.fn((values: Record<string, unknown>) => {
        updateCalls.push(values);
        return chain;
      });
      chain.delete = vi.fn(() => chain);
      const originalThen = chain.then;
      const updateMock = chain.update as ReturnType<typeof vi.fn>;
      const deleteMock = chain.delete as ReturnType<typeof vi.fn>;
      chain.then = (resolve: (v: { error: null }) => void) => {
        if (table === "collegeos_weekly_narratives" && updateMock.mock.calls.length > 0) return resolve({ error: null });
        if (table === "collegeos_weekly_narratives" && deleteMock.mock.calls.length > 0) {
          deleteCalls.push({ ...eqArgs });
          return resolve({ error: null });
        }
        return (originalThen as (r: (v: { data?: unknown; error: null }) => void) => void)(resolve as never);
      };
      return chain;
    });

    return { client: { from } as unknown as SupabaseClient, insertCalls, updateCalls, deleteCalls };
  }

  it("skips a user for whom today is not their own local week-start day (Sunday)", async () => {
    const { client } = makeClient({ profiles: [{ user_id: "user-1", timezone: "UTC" }] });
    const result = await dispatchCollegeOsWeeklyNarratives(client, A_TUESDAY);
    expect(result.generated).toBe(0);
    expect(gatewayChatMock).not.toHaveBeenCalled();
  });

  it("skips a user outside their own local generation window", async () => {
    const { client } = makeClient({ profiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
    const result = await dispatchCollegeOsWeeklyNarratives(client, AT_0359_LOCAL);
    expect(result.generated).toBe(0);
    expect(gatewayChatMock).not.toHaveBeenCalled();
  });

  it("generates at exactly the window open (04:00 local) on the local Sunday", async () => {
    gatewayChatMock.mockResolvedValue({ ok: true, content: "A great week." });
    const { client, updateCalls } = makeClient({ profiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
    const result = await dispatchCollegeOsWeeklyNarratives(client, AT_0400_LOCAL);
    expect(result.generated).toBe(1);
    expect(updateCalls[0]).toMatchObject({ narrative_text: "A great week." });
  });

  it("still generates near the end of the window (08:59 local)", async () => {
    gatewayChatMock.mockResolvedValue({ ok: true, content: "A great week." });
    const { client } = makeClient({ profiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
    const result = await dispatchCollegeOsWeeklyNarratives(client, AT_0859_LOCAL);
    expect(result.generated).toBe(1);
  });

  it("does not generate at or after the window close (09:00 local)", async () => {
    const { client } = makeClient({ profiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
    const result = await dispatchCollegeOsWeeklyNarratives(client, AT_0900_LOCAL);
    expect(result.generated).toBe(0);
    expect(gatewayChatMock).not.toHaveBeenCalled();
  });

  it("claims BEFORE calling gatewayChat -- a lost claim race skips without ever spending", async () => {
    const { client } = makeClient({
      profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
      claimedUsers: new Set(["user-1"]),
    });
    const result = await dispatchCollegeOsWeeklyNarratives(client, AT_0400_LOCAL);
    expect(result.generated).toBe(0);
    expect(gatewayChatMock).not.toHaveBeenCalled();
  });

  it("releases the claim (DELETE) when gatewayChat returns ok:false -- so a later tick this week can retry", async () => {
    gatewayChatMock.mockResolvedValue({ ok: false, message: "no key" });
    const { client, deleteCalls, insertCalls } = makeClient({ profiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
    const result = await dispatchCollegeOsWeeklyNarratives(client, AT_0400_LOCAL);
    expect(result.generated).toBe(0);
    expect(insertCalls).toHaveLength(1);
    expect(deleteCalls).toHaveLength(1);
  });

  it("one user's thrown error is caught, logged, and does not abort the batch for other users", async () => {
    getHoursByKindForRangeMock.mockRejectedValueOnce(new Error("connection reset"));
    gatewayChatMock.mockResolvedValue({ ok: true, content: "A great week." });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeClient({
      profiles: [
        { user_id: "u-broken", timezone: "America/Chicago" },
        { user_id: "u-fine", timezone: "America/Chicago" },
      ],
    });
    const result = await dispatchCollegeOsWeeklyNarratives(client, AT_0400_LOCAL);
    expect(result).toEqual({ usersChecked: 2, generated: 1 });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("u-broken"), expect.anything());
  });
});

describe("getCollegeOsWeeklyNarrative()", () => {
  function makeReadClient(resolvedValue: { data: unknown; error: unknown }) {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.maybeSingle = vi.fn(() => ({ returns: () => Promise.resolve(resolvedValue) }));
    return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
  }

  it("returns the narrative text for a real row", async () => {
    const client = makeReadClient({ data: { narrative_text: "A great week." }, error: null });
    const result = await getCollegeOsWeeklyNarrative(client, "u1", "2026-09-07");
    expect(result).toBe("A great week.");
  });

  it("returns null when nothing was generated for that week", async () => {
    const client = makeReadClient({ data: null, error: null });
    const result = await getCollegeOsWeeklyNarrative(client, "u1", "2026-09-07");
    expect(result).toBeNull();
  });

  it("returns null on a read error, never throws for a display-only reader", async () => {
    const client = makeReadClient({ data: null, error: { message: "boom" } });
    const result = await getCollegeOsWeeklyNarrative(client, "u1", "2026-09-07");
    expect(result).toBeNull();
  });
});
