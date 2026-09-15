import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * P2-22 04-verification failure (a9, live against production): a fixture
 * connection with an undecryptable stored token left `refreshCanvasCourses`
 * throwing straight out of `resolveStoredConnection`'s `decryptSecret` call
 * — no try/catch anywhere in the action, so the Server Action rejected, the
 * UI showed nothing, and canvas_connections' token_status/last_sync_error
 * were never written. Red first: these tests are written against the
 * PRE-FIX action and fail (the handler rejects instead of resolving to
 * {ok:false,...}) until the try/catch lands.
 */

function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "update", "upsert"]) chain[method] = vi.fn(() => chain);
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

const fetchCanvasCoursesMock = vi.fn();
vi.mock("@/lib/canvas/client", () => ({
  verifyCanvasToken: vi.fn(),
  fetchCanvasCourses: (...args: unknown[]) => fetchCanvasCoursesMock(...args),
}));

vi.mock("@/lib/net/safe-outbound-url", () => ({
  checkUrlSyntax: () => ({ ok: true }),
  resolveSafeOutboundUrl: async () => ({ ok: true }),
  safeOrigin: (s: string) => s,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("refreshCanvasCourses failure handling (P2-22 04-verification fix)", () => {
  beforeEach(() => {
    fromMock.mockClear();
    decryptSecretMock.mockReset();
    fetchCanvasCoursesMock.mockReset();
  });

  it("a decrypt failure resolves to {ok:false} and marks the connection expired with a reconnect message, instead of throwing", async () => {
    const connectionsChain = makeChain({ data: { instance_url: "https://school.instructure.com", encrypted_token: "garbage" }, error: null });
    fromImpl = (table) => (table === "canvas_connections" ? connectionsChain : makeChain({ data: null, error: null }));
    decryptSecretMock.mockImplementation(() => {
      throw new Error("Unsupported state or unable to authenticate data");
    });

    const { refreshCanvasCourses } = await import("../canvas-actions");
    const result = await refreshCanvasCourses();

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/reconnect/i);
    expect(fetchCanvasCoursesMock).not.toHaveBeenCalled();
    expect(connectionsChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ token_status: "expired", last_sync_error: expect.stringMatching(/reconnect/i) }),
    );
  });

  it("an unexpected exception after the connection resolves records a generic last_sync_error and returns {ok:false}, not a thrown rejection", async () => {
    const connectionsChain = makeChain({ data: { instance_url: "https://school.instructure.com", encrypted_token: "enc" }, error: null });
    fromImpl = (table) => (table === "canvas_connections" ? connectionsChain : makeChain({ data: null, error: null }));
    decryptSecretMock.mockImplementation((s: string) => s);
    fetchCanvasCoursesMock.mockRejectedValue(new Error("boom"));

    const { refreshCanvasCourses } = await import("../canvas-actions");
    const result = await refreshCanvasCourses();

    expect(result.ok).toBe(false);
    expect(connectionsChain.update).toHaveBeenCalledWith(expect.objectContaining({ last_sync_error: expect.any(String) }));
    // Not marked expired -- an unrelated exception isn't evidence the token is bad.
    const updateCall = connectionsChain.update.mock.calls.find((c) => "last_sync_error" in c[0]);
    expect(updateCall?.[0]).not.toHaveProperty("token_status");
  });
});
