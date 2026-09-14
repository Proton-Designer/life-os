import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * S6, 2026-09-14. Proves the gate this file's own header argues for: a
 * credential (a secret being set) must never satisfy `isIngestionAvailable`
 * on its own — only a RECENT heartbeat write does. See
 * ingestion-availability.ts's header for the full argument this encodes.
 */

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

function makeSelectChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => chain);
  // `.returns<T>()` is a compile-time cast in the real supabase-js client,
  // not a runtime step — but it IS the last method the real call chain
  // invokes before being awaited, so returning a real Promise from it here
  // is sufficient; the chain object itself never needs to be awaitable.
  chain.returns = vi.fn(() => Promise.resolve(result));
  return chain;
}

function makeUpdateChain(result: { error: unknown }) {
  const eq = vi.fn(() => Promise.resolve(result));
  const update = vi.fn(() => ({ eq }));
  return { update, eq };
}

describe("isIngestionAvailable", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is false when the heartbeat row has never been written (no row yet)", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    const from = vi.fn(() => makeSelectChain({ data: null, error: null }));
    vi.mocked(createServiceRoleClient).mockReturnValue({ from } as never);

    const { isIngestionAvailable } = await import("../ingestion-availability");
    expect(await isIngestionAvailable()).toBe(false);
  });

  it("is false when the read errors (e.g. the table isn't migrated yet) -- fails closed, not open", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    const from = vi.fn(() => makeSelectChain({ data: null, error: { message: 'relation "ingestion_driver_heartbeats" does not exist' } }));
    vi.mocked(createServiceRoleClient).mockReturnValue({ from } as never);

    const { isIngestionAvailable } = await import("../ingestion-availability");
    expect(await isIngestionAvailable()).toBe(false);
  });

  it("is true when the heartbeat was written recently", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    const from = vi.fn(() => makeSelectChain({ data: { last_polled_at: new Date().toISOString() }, error: null }));
    vi.mocked(createServiceRoleClient).mockReturnValue({ from } as never);

    const { isIngestionAvailable } = await import("../ingestion-availability");
    expect(await isIngestionAvailable()).toBe(true);
  });

  // THE RED CASE this whole file exists to guard against: a driver that
  // WAS running, then stopped (disabled, broken deploy, secret rotated out
  // from under it) must not leave the gate stuck open just because a row
  // exists from whenever it last worked.
  it("is false once the heartbeat goes stale -- the gate closes itself when the driver stops, no flag to remember to flip back off", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    const staleTimestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString(); // 6 min old
    const from = vi.fn(() => makeSelectChain({ data: { last_polled_at: staleTimestamp }, error: null }));
    vi.mocked(createServiceRoleClient).mockReturnValue({ from } as never);

    const { isIngestionAvailable } = await import("../ingestion-availability");
    expect(await isIngestionAvailable()).toBe(false);
  });
});

describe("recordIngestionDriverHeartbeat", () => {
  it("writes last_polled_at to the singleton row and returns true on success", async () => {
    const chain = makeUpdateChain({ error: null });
    const from = vi.fn(() => chain);
    const supabase = { from } as never;

    const { recordIngestionDriverHeartbeat } = await import("../ingestion-availability");
    const ok = await recordIngestionDriverHeartbeat(supabase);
    expect(ok).toBe(true);
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ last_polled_at: expect.any(String) }));
    expect(chain.eq).toHaveBeenCalledWith("id", 1);
  });

  it("is best-effort: a write failure returns false rather than throwing", async () => {
    const chain = makeUpdateChain({ error: { message: "write failed" } });
    const from = vi.fn(() => chain);
    const supabase = { from } as never;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { recordIngestionDriverHeartbeat } = await import("../ingestion-availability");
    await expect(recordIngestionDriverHeartbeat(supabase)).resolves.toBe(false);
    errorSpy.mockRestore();
  });
});
