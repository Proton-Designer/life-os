import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveWhoopConnectionCore, getWhoopConnectionStatusCore, disconnectWhoopCore } from "../connection-core";

vi.stubEnv("API_KEY_ENCRYPTION_SECRET", "a".repeat(32));

type Resp = { data: unknown; error: unknown };
function makeClient(responses: Record<string, Resp[]> = {}) {
  const queues: Record<string, Resp[]> = Object.fromEntries(Object.entries(responses).map(([k, v]) => [k, [...v]]));
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    for (const method of ["select", "eq", "upsert", "delete"]) chain[method] = vi.fn(record(method));
    chain.maybeSingle = vi.fn(() => Promise.resolve((queues[table] ?? []).shift() ?? { data: null, error: null }));
    const resolve = (): Resp => (queues[table] ?? []).shift() ?? { data: null, error: null };
    chain.then = (res: (v: Resp) => void) => res(resolve());
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("saveWhoopConnectionCore (P3-18)", () => {
  it("encrypts both tokens and stores only a last4 hint of the access token -- never the plaintext", async () => {
    const { client, calls } = makeClient();
    await saveWhoopConnectionCore(client, "user-1", { accessToken: "access-secret-abcd", refreshToken: "refresh-secret-xyz", expiresAt: "2026-09-16T00:00:00Z", scope: "offline read:sleep" });

    const upsertCall = calls.find((c) => c.table === "whoop_connections" && c.method === "upsert")!;
    const payload = upsertCall.args[0] as Record<string, unknown>;
    expect(payload.encrypted_access_token).not.toBe("access-secret-abcd");
    expect(payload.encrypted_refresh_token).not.toBe("refresh-secret-xyz");
    expect(String(payload.encrypted_access_token)).not.toContain("access-secret-abcd");
    expect(String(payload.encrypted_refresh_token)).not.toContain("refresh-secret-xyz");
    expect(payload.access_token_last4).toBe("abcd");
    expect(payload.user_id).toBe("user-1");
    expect(payload.scope).toBe("offline read:sleep");
  });
});

describe("getWhoopConnectionStatusCore (P3-18)", () => {
  it("returns disconnected when no row exists", async () => {
    const { client } = makeClient({ whoop_connections: [{ data: null, error: null }] });
    expect(await getWhoopConnectionStatusCore(client, "user-1")).toEqual({ connected: false, accessTokenLast4: null, connectedAt: null, scope: null });
  });

  it("returns connection status WITHOUT ever selecting the encrypted token columns", async () => {
    const { client, calls } = makeClient({ whoop_connections: [{ data: { access_token_last4: "abcd", connected_at: "2026-09-15T00:00:00Z", scope: "offline" }, error: null }] });
    const status = await getWhoopConnectionStatusCore(client, "user-1");
    expect(status).toEqual({ connected: true, accessTokenLast4: "abcd", connectedAt: "2026-09-15T00:00:00Z", scope: "offline" });

    const selectCall = calls.find((c) => c.table === "whoop_connections" && c.method === "select")!;
    const selectArg = String(selectCall.args[0]);
    expect(selectArg).not.toMatch(/encrypted/);
  });
});

describe("disconnectWhoopCore (P3-18)", () => {
  it("deletes the row scoped to the caller's own user_id", async () => {
    const { client, calls } = makeClient();
    await disconnectWhoopCore(client, "user-1");
    const deleteCall = calls.find((c) => c.table === "whoop_connections" && c.method === "delete")!;
    expect(deleteCall).toBeDefined();
    const eqCall = calls.find((c) => c.table === "whoop_connections" && c.method === "eq")!;
    expect(eqCall.args).toEqual(["user_id", "user-1"]);
  });
});
