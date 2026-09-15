import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "update", "upsert", "delete"]) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));
const requireUserMock = vi.fn(async () => ({ supabase: { from: fromMock } as unknown as SupabaseClient, userId: "user-1" }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: () => requireUserMock() }));

const decryptSecretMock = vi.fn((s: string) => s);
vi.mock("@/lib/ai/encryption", () => ({
  encryptSecret: (s: string) => s,
  decryptSecret: (s: string) => decryptSecretMock(s),
  isKeyStorageConfigured: () => true,
  last4: (s: string) => s.slice(-4),
}));

type RescueTimeResult<T> = { ok: true; data: T } | { ok: false; message: string };
const verifyRescueTimeKeyMock = vi.fn(async (..._args: unknown[]): Promise<RescueTimeResult<true>> => ({ ok: true, data: true }));
const fetchDailySummariesMock = vi.fn(async (..._args: unknown[]) => ({ ok: true as const, data: [] as unknown[] }));
vi.mock("@/lib/rescuetime/client", () => ({
  verifyRescueTimeKey: (...args: unknown[]) => verifyRescueTimeKeyMock(...args),
  fetchDailySummaries: (...args: unknown[]) => fetchDailySummariesMock(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("rescuetime-actions", () => {
  beforeEach(() => {
    fromMock.mockClear();
    decryptSecretMock.mockReset();
    decryptSecretMock.mockImplementation((s: string) => s);
    verifyRescueTimeKeyMock.mockReset();
    verifyRescueTimeKeyMock.mockResolvedValue({ ok: true, data: true });
    fetchDailySummariesMock.mockReset();
    fetchDailySummariesMock.mockResolvedValue({ ok: true, data: [] });
  });

  describe("connectRescueTime", () => {
    it("verifies the key BEFORE storing it, and rejects an empty key without calling the client", async () => {
      const { connectRescueTime } = await import("../rescuetime-actions");
      const res = await connectRescueTime("   ");
      expect(res.ok).toBe(false);
      expect(verifyRescueTimeKeyMock).not.toHaveBeenCalled();
    });

    it("rejects a bad key and never stores it", async () => {
      verifyRescueTimeKeyMock.mockResolvedValue({ ok: false, message: "RescueTime rejected that key." });
      const chain = makeChain({ data: null, error: null });
      fromImpl = () => chain;
      const { connectRescueTime } = await import("../rescuetime-actions");

      const res = await connectRescueTime("bad-key");

      expect(res.ok).toBe(false);
      expect(chain.upsert).not.toHaveBeenCalled();
    });

    it("stores the encrypted key on a verified connect", async () => {
      const chain = makeChain({ data: null, error: null });
      fromImpl = () => chain;
      const { connectRescueTime } = await import("../rescuetime-actions");

      const res = await connectRescueTime("rt-good-key");

      expect(res.ok).toBe(true);
      expect(chain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: "user-1", encrypted_key: "rt-good-key", key_last4: "-key" }),
        { onConflict: "user_id" },
      );
    });
  });

  describe("syncRescueTimeSummaries", () => {
    it("returns a clear message and never calls the client when nothing is connected", async () => {
      const chain = makeChain({ data: null, error: null });
      fromImpl = () => chain;
      const { syncRescueTimeSummaries } = await import("../rescuetime-actions");

      const res = await syncRescueTimeSummaries();

      expect(res).toEqual({ ok: false, message: "Connect RescueTime first." });
      expect(fetchDailySummariesMock).not.toHaveBeenCalled();
    });

    // P2-22-style fix, built in from the start rather than discovered live.
    it("a decrypt failure resolves to {ok:false} with a reconnect message, never throws", async () => {
      const chain = makeChain({ data: { encrypted_key: "garbage" }, error: null });
      fromImpl = () => chain;
      decryptSecretMock.mockImplementation(() => {
        throw new Error("Unsupported state or unable to authenticate data");
      });
      const { syncRescueTimeSummaries } = await import("../rescuetime-actions");

      const res = await syncRescueTimeSummaries();

      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/reconnect/i);
      expect(fetchDailySummariesMock).not.toHaveBeenCalled();
      expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ last_sync_error: expect.stringMatching(/reconnect/i) }));
    });

    it("a thrown fetch error records last_sync_error and resolves {ok:false}, never throws", async () => {
      const chain = makeChain({ data: { encrypted_key: "enc" }, error: null });
      fromImpl = () => chain;
      fetchDailySummariesMock.mockRejectedValue(new Error("boom"));
      const { syncRescueTimeSummaries } = await import("../rescuetime-actions");

      const res = await syncRescueTimeSummaries();

      expect(res.ok).toBe(false);
      expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ last_sync_error: "boom" }));
    });

    it("upserts fetched rows and records a successful sync", async () => {
      const chain = makeChain({ data: { encrypted_key: "enc" }, error: null });
      fromImpl = () => chain;
      fetchDailySummariesMock.mockResolvedValue({
        ok: true,
        data: [
          { date: "2026-09-14", productivityPulse: 65, veryProductivePct: 20, productivePct: 30, neutralPct: 25, distractingPct: 15, veryDistractingPct: 9, totalHours: 8.5 },
        ],
      });
      const { syncRescueTimeSummaries } = await import("../rescuetime-actions");

      const res = await syncRescueTimeSummaries();

      expect(res).toEqual({ ok: true, message: "Synced 1 day." });
      expect(chain.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ user_id: "user-1", summary_date: "2026-09-14", productivity_pulse: 65 })]),
        { onConflict: "user_id,summary_date" },
      );
      expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ last_sync_error: null }));
    });
  });
});
