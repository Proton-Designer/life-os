import { describe, expect, it } from "vitest";
import { makeFakeMcpDb } from "@/lib/scheduling/__tests__/fake-mcp-tables";
import {
  createAccessToken,
  getLiveTokenById,
  hashToken,
  listAccessTokens,
  verifyAccessToken,
  MAX_LIVE_TOKENS_PER_USER,
} from "../tokens";

/**
 * P4-12 (migration 215): token expiry, client kind, per-user live-token cap.
 *
 * Runs the REAL tokens.ts functions against an in-memory table, so what is
 * asserted is the row that ends up stored / the verdict on a stored row, not
 * which chain methods were called.
 */

const U = "user-1";
const now = Date.now();
const iso = (msFromNow: number) => new Date(now + msFromNow).toISOString();
const DAY = 86_400_000;

function tokenRow(raw: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `tok-${raw}`,
    user_id: U,
    token_hash: hashToken(raw),
    token_last4: raw.slice(-4),
    label: null,
    scopes: ["read", "write"],
    created_at: iso(-10 * DAY),
    last_used_at: null,
    revoked_at: null,
    expires_at: null,
    client_kind: "pat",
    ...overrides,
  };
}

describe("P4-12 expiry: verifyAccessToken (live MCP/REST calls)", () => {
  // THE POSITIVE CONTROL the task names: before P4-12 this token was accepted.
  it("REJECTS a token whose expires_at is in the past", async () => {
    const db = makeFakeMcpDb({ mcp_access_tokens: [tokenRow("expired", { expires_at: iso(-60_000) })] });
    expect(await verifyAccessToken(db.client, "expired")).toBeNull();
  });

  it("REJECTS a token expiring exactly now-ish (expires_at <= now is dead)", async () => {
    const db = makeFakeMcpDb({ mcp_access_tokens: [tokenRow("edge", { expires_at: iso(-1) })] });
    expect(await verifyAccessToken(db.client, "edge")).toBeNull();
  });

  it("ACCEPTS a token that expires in the future", async () => {
    const db = makeFakeMcpDb({ mcp_access_tokens: [tokenRow("future", { expires_at: iso(DAY) })] });
    expect(await verifyAccessToken(db.client, "future")).toEqual({ userId: U, tokenId: "tok-future", scopes: ["read", "write"] });
  });

  it("existing never-expiring tokens (expires_at NULL) are unaffected", async () => {
    const db = makeFakeMcpDb({ mcp_access_tokens: [tokenRow("never")] });
    expect(await verifyAccessToken(db.client, "never")).not.toBeNull();
  });
});

describe("P4-12 expiry: getLiveTokenById (scheduled fires)", () => {
  it("REJECTS an expired token, so the scheduler denies the fire", async () => {
    const db = makeFakeMcpDb({ mcp_access_tokens: [tokenRow("expired", { expires_at: iso(-60_000) })] });
    expect(await getLiveTokenById(db.client, "tok-expired")).toBeNull();
  });

  it("still returns a live never-expiring token", async () => {
    const db = makeFakeMcpDb({ mcp_access_tokens: [tokenRow("never")] });
    expect(await getLiveTokenById(db.client, "tok-never")).toEqual({ userId: U, scopes: ["read", "write"] });
  });
});

describe("P4-12 createAccessToken: expiry + client kind are stored", () => {
  it("defaults to a never-expiring 'pat'", async () => {
    const db = makeFakeMcpDb({ mcp_access_tokens: [] });
    const res = await createAccessToken(db.client, U, "laptop", ["read"]);
    expect(res.ok).toBe(true);
    expect(db.tables.mcp_access_tokens[0]).toMatchObject({ user_id: U, client_kind: "pat", expires_at: null });
  });

  it("stores the given expiry and kind", async () => {
    const db = makeFakeMcpDb({ mcp_access_tokens: [] });
    const expiresAt = iso(30 * DAY);
    const res = await createAccessToken(db.client, U, "OAuth: Claude", ["read", "write"], { expiresAt, clientKind: "mcp_oauth" });
    expect(res.ok).toBe(true);
    expect(db.tables.mcp_access_tokens[0]).toMatchObject({ client_kind: "mcp_oauth", expires_at: expiresAt });
  });

  it("refuses an expiry that is not in the future, before touching the DB", async () => {
    const db = makeFakeMcpDb({ mcp_access_tokens: [] });
    const res = await createAccessToken(db.client, U, "x", ["read"], { expiresAt: iso(-DAY) });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/future/i);
    expect(db.tables.mcp_access_tokens).toHaveLength(0);
  });

  it("listAccessTokens surfaces expiresAt and clientKind", async () => {
    const db = makeFakeMcpDb({ mcp_access_tokens: [tokenRow("a", { expires_at: iso(DAY), client_kind: "mcp_oauth" })] });
    const [status] = await listAccessTokens(db.client, U);
    expect(status).toMatchObject({ expiresAt: iso(DAY), clientKind: "mcp_oauth" });
  });
});

describe("P4-12 per-user live-token cap", () => {
  it(`the cap is ${20}`, () => {
    expect(MAX_LIVE_TOKENS_PER_USER).toBe(20);
  });

  it("REFUSES the 21st live token with a clear message and inserts nothing", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => tokenRow(`live${i}`));
    const db = makeFakeMcpDb({ mcp_access_tokens: rows });
    const res = await createAccessToken(db.client, U, "one too many", ["read"]);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/20/);
    expect(res.message).toMatch(/revoke/i);
    expect(db.tables.mcp_access_tokens).toHaveLength(20);
  });

  it("revoked and expired tokens do not count toward the cap; other users' tokens do not either", async () => {
    const rows = [
      ...Array.from({ length: 19 }, (_, i) => tokenRow(`live${i}`)),
      ...Array.from({ length: 5 }, (_, i) => tokenRow(`revoked${i}`, { revoked_at: iso(-DAY) })),
      ...Array.from({ length: 5 }, (_, i) => tokenRow(`expired${i}`, { expires_at: iso(-DAY) })),
      ...Array.from({ length: 25 }, (_, i) => tokenRow(`other${i}`, { user_id: "user-2" })),
    ];
    const db = makeFakeMcpDb({ mcp_access_tokens: rows });
    const res = await createAccessToken(db.client, U, "20th live", ["read"]);
    expect(res.ok).toBe(true);
  });

  it("maps the database trigger's cap error (the race path) to the same clear message, not a generic failure", async () => {
    const db = makeFakeMcpDb({ mcp_access_tokens: [] });
    db.failOn.add("mcp_access_tokens:insert");
    db.failMessage["mcp_access_tokens:insert"] =
      "mcp_token_cap: this account already has 20 live tokens (limit 20). Revoke one in Settings before creating another.";
    const res = await createAccessToken(db.client, U, "raced", ["read"]);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/20/);
    expect(res.message).toMatch(/revoke/i);
    expect(res.message).not.toMatch(/mcp_token_cap/);
  });
});
