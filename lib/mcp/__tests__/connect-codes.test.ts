import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const createAccessToken = vi.fn();
vi.mock("@/lib/mcp/tokens", async (importActual) => ({
  // Real hashToken/validateScopes/MCP_SCOPES, so these tests assert against
  // the actual hashing + scope validation that ships, not a mock's stand-in.
  ...(await importActual<typeof import("@/lib/mcp/tokens")>()),
  createAccessToken: (...args: unknown[]) => createAccessToken(...args),
}));

import { hashToken } from "@/lib/mcp/tokens";
import { createConnectCodeCore, exchangeConnectCodeCore } from "../connect-codes";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert", "update", "is"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

beforeEach(() => {
  createAccessToken.mockReset();
});

describe("createConnectCodeCore", () => {
  it("mints a code, stores ONLY its hash + the user's chosen scopes/expiry, and returns the raw code exactly once", async () => {
    const insertChain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => insertChain) } as unknown as SupabaseClient;

    const result = await createConnectCodeCore(client, "user-1", ["read"], "30", "My agent");

    expect(result.ok).toBe(true);
    expect(result.code).toBeTruthy();
    expect(result.expiresAt).toBeTruthy();
    const insertedRow = insertChain.insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertedRow.user_id).toBe("user-1");
    expect(insertedRow.scopes).toEqual(["read"]);
    expect(insertedRow.token_expiry_choice).toBe("30");
    expect(insertedRow.label).toBe("My agent");
    expect(insertedRow.code_hash).toBe(hashToken(result.code!));
    // The raw code itself must never appear anywhere in what gets written.
    expect(JSON.stringify(insertedRow)).not.toContain(result.code);
  });

  it("refuses a blanket/unknown scope rather than silently widening or narrowing it", async () => {
    const client = { from: vi.fn() } as unknown as SupabaseClient;
    const result = await createConnectCodeCore(client, "user-1", ["read", "admin"] as never, "30");
    expect(result.ok).toBe(false);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("refuses an invalid expiry choice", async () => {
    const client = { from: vi.fn() } as unknown as SupabaseClient;
    const result = await createConnectCodeCore(client, "user-1", ["read"], "not-a-choice" as never);
    expect(result.ok).toBe(false);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("reports failure, never a fabricated code, on a genuine insert error", async () => {
    const insertChain = makeChain({ data: null, error: new Error("db down") });
    const client = { from: vi.fn(() => insertChain) } as unknown as SupabaseClient;

    const result = await createConnectCodeCore(client, "user-1", ["read"], "30");

    expect(result.ok).toBe(false);
    expect(result.code).toBeUndefined();
  });
});

describe("exchangeConnectCodeCore", () => {
  const liveRow = {
    id: "code-1",
    user_id: "user-1",
    scopes: ["read"],
    token_expiry_choice: "30",
    label: "My agent",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    used_at: null,
  };

  it("mints a real access token and burns the code on a fresh, unused, unexpired code", async () => {
    const selectChain = makeChain({ data: liveRow, error: null });
    const burnChain = makeChain({ data: { id: "code-1" }, error: null });
    const stampChain = makeChain({ data: null, error: null });
    let call = 0;
    const from = vi.fn(() => {
      call += 1;
      if (call === 1) return selectChain;
      if (call === 2) return burnChain;
      return stampChain;
    });
    const client = { from } as unknown as SupabaseClient;
    createAccessToken.mockResolvedValue({ ok: true, token: "raw-minted-token", status: { id: "token-1", scopes: ["read"], expiresAt: null } });

    const result = await exchangeConnectCodeCore(client, "raw-code");

    expect(result).toEqual({ ok: true, token: "raw-minted-token", status: { id: "token-1", scopes: ["read"], expiresAt: null } });
    // Burn is a CONDITIONAL update guarded on used_at IS NULL, not a blind write.
    expect(burnChain.update).toHaveBeenCalledWith(expect.objectContaining({ used_at: expect.any(String) }));
    expect(burnChain.eq).toHaveBeenCalledWith("id", "code-1");
    expect(burnChain.is).toHaveBeenCalledWith("used_at", null);
    // Minted with client_kind "agent", the user's own stored scopes/expiry choice, and the code's own label.
    expect(createAccessToken).toHaveBeenCalledWith(client, "user-1", "My agent", ["read"], expect.objectContaining({ clientKind: "agent" }));
    // Stamps minted_token_id after a successful mint.
    expect(stampChain.update).toHaveBeenCalledWith(expect.objectContaining({ minted_token_id: "token-1" }));
  });

  it("rejects an unknown code", async () => {
    const selectChain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => selectChain) } as unknown as SupabaseClient;

    const result = await exchangeConnectCodeCore(client, "unknown-code");

    expect(result).toEqual({ ok: false });
    expect(createAccessToken).not.toHaveBeenCalled();
  });

  it("rejects an already-used code, with the SAME shape as an unknown code (no enumeration signal)", async () => {
    const usedRow = { ...liveRow, used_at: "2026-09-16T00:00:00Z" };
    const selectChain = makeChain({ data: usedRow, error: null });
    const client = { from: vi.fn(() => selectChain) } as unknown as SupabaseClient;

    const result = await exchangeConnectCodeCore(client, "used-code");

    expect(result).toEqual({ ok: false });
    expect(createAccessToken).not.toHaveBeenCalled();
  });

  it("rejects an expired code, with the SAME shape as unknown/used", async () => {
    const expiredRow = { ...liveRow, expires_at: new Date(Date.now() - 1000).toISOString() };
    const selectChain = makeChain({ data: expiredRow, error: null });
    const client = { from: vi.fn(() => selectChain) } as unknown as SupabaseClient;

    const result = await exchangeConnectCodeCore(client, "expired-code");

    expect(result).toEqual({ ok: false });
    expect(createAccessToken).not.toHaveBeenCalled();
  });

  it("a lost race on the conditional burn (someone else consumed it microseconds earlier) fails rather than double-minting", async () => {
    const selectChain = makeChain({ data: liveRow, error: null });
    // The conditional UPDATE (guarded on used_at IS NULL) finds nothing to update -- another request won the race.
    const burnChain = makeChain({ data: null, error: null });
    let call = 0;
    const from = vi.fn(() => {
      call += 1;
      return call === 1 ? selectChain : burnChain;
    });
    const client = { from } as unknown as SupabaseClient;

    const result = await exchangeConnectCodeCore(client, "raw-code");

    expect(result).toEqual({ ok: false });
    expect(createAccessToken).not.toHaveBeenCalled();
  });

  it("reports failure without stamping success when token minting itself fails", async () => {
    const selectChain = makeChain({ data: liveRow, error: null });
    const burnChain = makeChain({ data: { id: "code-1" }, error: null });
    let call = 0;
    const from = vi.fn(() => {
      call += 1;
      return call === 1 ? selectChain : burnChain;
    });
    const client = { from } as unknown as SupabaseClient;
    createAccessToken.mockResolvedValue({ ok: false, message: "cap reached" });

    const result = await exchangeConnectCodeCore(client, "raw-code");

    expect(result).toEqual({ ok: false });
  });
});
