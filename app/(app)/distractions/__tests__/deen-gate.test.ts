import { beforeEach, describe, expect, it, vi } from "vitest";

// Cookie-path distraction actions: Deen Mode OFF refuses new deen-domain
// triggers and reflection tiers (they create deen data) and hides deen
// triggers from the lists. Existing rows are never touched (R4).
const fromMock = vi.fn();
const guard = vi.fn(async () => false);
const triggers = [
  { id: "t1", domain: "deen", name: "phone at dhikr", todayCount: 0, totalCount: 1 },
  { id: "t2", domain: "business", name: "email", todayCount: 0, totalCount: 2 },
];

vi.mock("@/lib/supabase/auth", () => ({
  requireUser: vi.fn(async () => ({ supabase: { from: fromMock }, userId: "u1" })),
  getProfile: vi.fn(async () => ({ timezone: "UTC" })),
}));
vi.mock("@/lib/deen/deen-mode-guard", () => ({ isDeenModeOnForRequest: guard }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/distractions/queries", () => ({
  getAllTriggers: vi.fn(async () => triggers),
  getTriggersForDomain: vi.fn(async (_s: unknown, _u: string, _d: string, domain: string) => triggers.filter((t) => t.domain === domain)),
  getTodayDistractionCount: vi.fn(),
  getSessionDistractionCount: vi.fn(),
}));

function profileChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: { timezone: "UTC" }, error: null }));
  return chain;
}

describe("distractions/actions.ts -- Faith Mode", () => {
  beforeEach(() => {
    fromMock.mockReset();
    fromMock.mockImplementation((t: string) => {
      if (t === "profiles") return profileChain();
      throw new Error(`DB write touched: ${t}`);
    });
    guard.mockReset();
    guard.mockResolvedValue(false);
  });

  it("createTriggerAndLog refuses a new deen-domain trigger and writes nothing", async () => {
    const { createTriggerAndLog } = await import("../actions");
    await expect(createTriggerAndLog({ domain: "deen", name: "x", description: null })).rejects.toThrow(/Faith Mode is off/);
    expect(fromMock).not.toHaveBeenCalledWith("distraction_triggers");
  });

  it("createTriggerAndLog refuses a reflection tier even on a non-deen domain", async () => {
    const { createTriggerAndLog } = await import("../actions");
    await expect(createTriggerAndLog({ domain: "business", name: "x", description: null, tier: 2 })).rejects.toThrow(/Faith Mode is off/);
    expect(fromMock).not.toHaveBeenCalledWith("reflection_entries");
  });

  it("logDistraction refuses a tier", async () => {
    const { logDistraction } = await import("../actions");
    await expect(logDistraction("t2", 1)).rejects.toThrow(/Faith Mode is off/);
    expect(fromMock).not.toHaveBeenCalledWith("reflection_entries");
  });

  it("lists hide deen triggers when OFF", async () => {
    const { listTriggersForDomain, listTopTriggersForQuickLog } = await import("../actions");
    expect(await listTriggersForDomain("deen")).toEqual([]);
    expect((await listTopTriggersForQuickLog()).map((t) => t.id)).toEqual(["t2"]);
  });

  it("positive control: ON lists deen triggers and lets the deen-domain create past the gate", async () => {
    guard.mockResolvedValue(true);
    const { listTriggersForDomain, listTopTriggersForQuickLog, createTriggerAndLog } = await import("../actions");
    expect((await listTriggersForDomain("deen")).map((t) => t.id)).toEqual(["t1"]);
    expect((await listTopTriggersForQuickLog()).map((t) => t.id)).toEqual(["t1", "t2"]);
    await expect(createTriggerAndLog({ domain: "deen", name: "x", description: null })).rejects.toThrow(/DB write touched/);
  });
});
