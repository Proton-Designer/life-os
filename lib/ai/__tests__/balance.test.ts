import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDeepSeekBalance } from "../balance";

describe("getDeepSeekBalance()", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("parses DeepSeek's real observed /user/balance shape (string dollar figures)", async () => {
    // Exact shape returned by a real call against the live account while
    // building this gateway (2026-09-13): total_balance is a STRING.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        is_available: true,
        balance_infos: [{ currency: "USD", total_balance: "1.98", granted_balance: "0.00", topped_up_balance: "1.98" }],
      }),
    });
    const balance = await getDeepSeekBalance("sk-test");
    expect(balance).toEqual({ currency: "USD", totalBalanceUsd: 1.98, isAvailable: true });
  });

  it("returns null on a non-2xx response rather than throwing", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await getDeepSeekBalance("sk-bad")).toBeNull();
  });

  it("returns null on a network failure rather than throwing", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await getDeepSeekBalance("sk-test")).toBeNull();
  });

  it("returns null on a malformed/unexpected body shape rather than throwing or returning NaN", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ balance_infos: [] }) });
    expect(await getDeepSeekBalance("sk-test")).toBeNull();
  });
});
