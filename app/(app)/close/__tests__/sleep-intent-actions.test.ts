import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "upsert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => chain);
  chain.returns = vi.fn(() => Promise.resolve(resolvedValue));
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

let currentChain: ReturnType<typeof makeChain>;
const requireUserMock = vi.fn(async () => ({
  supabase: { from: vi.fn(() => currentChain) } as unknown as SupabaseClient,
  userId: "user-1",
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
  getProfile: vi.fn(async () => ({ timezone: "America/Chicago" })),
}));
let enabledFeatures: string[] = ["sleep_plan"];
vi.mock("@/lib/opt-in-guard", () => ({
  isOptInFeatureOnForRequest: async (id: string) => enabledFeatures.includes(id),
  FEATURE_OFF_MESSAGE: "This feature is off.",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { getMySleepIntentForToday, saveMySleepIntent, clearMySleepIntent } = await import("../sleep-intent-actions");

beforeEach(() => {
  enabledFeatures = ["sleep_plan"];
  requireUserMock.mockClear();
  // Pinned rather than relying on the real system clock -- `intent_date`
  // is derived from `new Date()` in the actions file (no injectable `now`
  // param, since these are "use server" actions called from a client
  // component with a fixed signature), so a test asserting an exact date
  // string must control the clock explicitly.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T13:00:00.000Z")); // 08:00 America/Chicago
});
afterEach(() => {
  vi.useRealTimers();
});

describe("getMySleepIntentForToday", () => {
  it("returns the stored bedtime for today", async () => {
    currentChain = makeChain({ data: { intended_bedtime: "22:30" }, error: null });
    const result = await getMySleepIntentForToday();
    expect(result).toBe("22:30");
  });

  it("returns null when nothing was set (or it was cleared) -- not an error", async () => {
    currentChain = makeChain({ data: null, error: null });
    const result = await getMySleepIntentForToday();
    expect(result).toBeNull();
  });

  it("a read error also returns null, never throws -- display-only, best-effort read", async () => {
    currentChain = makeChain({ data: null, error: { message: "connection reset" } });
    await expect(getMySleepIntentForToday()).resolves.toBeNull();
  });
});

describe("saveMySleepIntent", () => {
  it("upserts a valid HH:MM time, scoped to today's local date and this user", async () => {
    currentChain = makeChain({ data: null, error: null });
    const result = await saveMySleepIntent("22:45");
    expect(result.ok).toBe(true);
    expect(currentChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", intent_date: "2026-09-15", intended_bedtime: "22:45" }),
      expect.objectContaining({ onConflict: "user_id,intent_date" }),
    );
  });

  it("THE REGRESSION GUARD: rejects a malformed time BEFORE ever calling upsert", async () => {
    currentChain = makeChain({ data: null, error: null });
    const result = await saveMySleepIntent("25:99");
    expect(result.ok).toBe(false);
    expect(currentChain.upsert).not.toHaveBeenCalled();
  });

  it("a write error surfaces as ok:false, not a throw", async () => {
    currentChain = makeChain({ data: null, error: { message: "boom" } });
    const result = await saveMySleepIntent("22:00");
    expect(result.ok).toBe(false);
  });
});

describe("clearMySleepIntent", () => {
  it("deletes today's row for this user", async () => {
    currentChain = makeChain({ data: null, error: null });
    const result = await clearMySleepIntent();
    expect(result.ok).toBe(true);
    expect(currentChain.delete).toHaveBeenCalled();
    expect(currentChain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(currentChain.eq).toHaveBeenCalledWith("intent_date", "2026-09-15");
  });
});

// RS-01: Sleep plan is an opt-in feature, OFF by default. A Server Action is a public endpoint,
// so OFF must refuse (reads degrade to null) and never touch the data.
describe("Sleep plan feature OFF", () => {
  it("reads null without querying, and refuses save and clear", async () => {
    enabledFeatures = [];
    currentChain = makeChain({ data: { intended_bedtime: "22:30" }, error: null });
    expect(await getMySleepIntentForToday()).toBeNull();
    expect(await saveMySleepIntent("22:30")).toEqual({ ok: false, message: "This feature is off." });
    expect(await clearMySleepIntent()).toEqual({ ok: false, message: "This feature is off." });
    expect(currentChain.upsert).not.toHaveBeenCalled();
    expect(currentChain.delete).not.toHaveBeenCalled();
  });
});
