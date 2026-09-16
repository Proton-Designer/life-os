import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUserMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: (...args: unknown[]) => requireUserMock(...args),
}));

const isWhoopConfiguredMock = vi.fn();
vi.mock("@/lib/whoop/config", () => ({
  isWhoopConfigured: (...args: unknown[]) => isWhoopConfiguredMock(...args),
}));

const getWhoopConnectionStatusCoreMock = vi.fn();
const disconnectWhoopCoreMock = vi.fn();
vi.mock("@/lib/whoop/connection-core", () => ({
  getWhoopConnectionStatusCore: (...args: unknown[]) => getWhoopConnectionStatusCoreMock(...args),
  disconnectWhoopCore: (...args: unknown[]) => disconnectWhoopCoreMock(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { getWhoopSettingsStatus, disconnectWhoop } = await import("../whoop-actions");

beforeEach(() => {
  requireUserMock.mockReset();
  isWhoopConfiguredMock.mockReset();
  getWhoopConnectionStatusCoreMock.mockReset();
  disconnectWhoopCoreMock.mockReset();
});

describe("getWhoopSettingsStatus (P3-18)", () => {
  it("when NOT configured: returns configured:false immediately, never calls requireUser or reads a connection row -- this is the real, only reachable state tonight", async () => {
    isWhoopConfiguredMock.mockReturnValue(false);
    const status = await getWhoopSettingsStatus();
    expect(status).toEqual({ configured: false, connected: false, accessTokenLast4: null, connectedAt: null, scope: null });
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(getWhoopConnectionStatusCoreMock).not.toHaveBeenCalled();
  });

  it("when configured: reads the caller's own connection status", async () => {
    isWhoopConfiguredMock.mockReturnValue(true);
    requireUserMock.mockResolvedValue({ supabase: "client", userId: "user-1" });
    getWhoopConnectionStatusCoreMock.mockResolvedValue({ connected: true, accessTokenLast4: "abcd", connectedAt: "2026-09-15T00:00:00Z", scope: "offline" });

    const status = await getWhoopSettingsStatus();

    expect(getWhoopConnectionStatusCoreMock).toHaveBeenCalledWith("client", "user-1");
    expect(status).toEqual({ configured: true, connected: true, accessTokenLast4: "abcd", connectedAt: "2026-09-15T00:00:00Z", scope: "offline" });
  });
});

describe("disconnectWhoop (P3-18)", () => {
  it("disconnects the caller's own connection", async () => {
    requireUserMock.mockResolvedValue({ supabase: "client", userId: "user-1" });
    disconnectWhoopCoreMock.mockResolvedValue(undefined);
    const res = await disconnectWhoop();
    expect(disconnectWhoopCoreMock).toHaveBeenCalledWith("client", "user-1");
    expect(res).toEqual({ ok: true, message: "Disconnected." });
  });

  it("a DB failure returns ok:false rather than throwing", async () => {
    requireUserMock.mockResolvedValue({ supabase: "client", userId: "user-1" });
    disconnectWhoopCoreMock.mockRejectedValue(new Error("db down"));
    const res = await disconnectWhoop();
    expect(res.ok).toBe(false);
  });
});
