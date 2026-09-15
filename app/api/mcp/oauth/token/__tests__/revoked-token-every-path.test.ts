import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { makeFakeMcpDb, type FakeMcpDb } from "@/lib/scheduling/__tests__/fake-mcp-tables";
import { installRefreshGrantEmulation } from "@/lib/scheduling/__tests__/fake-refresh-grant";

/**
 * P4-11 security fix (e): ONE revoked access token, pushed through EVERY
 * code path that loads a token by id or by hash, or that can turn a token
 * into a grant. Each must treat it as dead. Real token/OAuth/runner code
 * against one in-memory DB; only GoTrue's active check, the audit insert,
 * and the tool dispatch are stubbed.
 *
 * The paths (from the (f) sweep, see the P4-11 task Log):
 *   hash  -> verifyAccessToken         (per HTTP request: app/api/mcp/route.ts verifyToken)
 *   HTTP  -> POST /api/mcp             (withMcpAuth -> verifyToken -> 401)
 *   id    -> getLiveTokenById          (scheduled fires)
 *   grant -> POST /oauth/token refresh (the revoked token's own unused refresh token;
 *            since P4-13 that is mcp_oauth_refresh_grant, migration 217, run
 *            here as its JS mirror -- getTokenScopesById no longer exists)
 *   refresh-token hash -> findAccessTokenForRefreshToken (reuse detection only;
 *            it may return the row, but following it never yields a grant)
 *   runner -> processOneScheduledAction (denied, row paused)
 *   cap    -> createAccessToken's live count ignores it
 *   bookkeeping -> touchLastUsed must not stamp it
 * readMcpAuth (lib/mcp/auth-info.ts) reads the AuthInfo that verifyToken
 * built for THIS request; it never loads a token, so it is covered by the
 * HTTP 401 case (a revoked token never gets an AuthInfo at all).
 */

let db: FakeMcpDb;
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => db.client) }));
vi.mock("@/lib/mcp/active-user", () => ({ isUserActive: vi.fn(async () => true) }));
vi.mock("@/lib/mcp/audit", () => ({ writeAuditRow: vi.fn(async () => {}) }));
const dispatched = vi.fn();
vi.mock("@/lib/agent-api/execute", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/agent-api/execute")>()),
  executeOperation: async () => {
    dispatched();
    const toolResult: CallToolResult = { content: [{ type: "text", text: "{}" }] };
    return { ok: true, data: null, text: "{}", summary: "ok", toolResult };
  },
}));
vi.mock("@/lib/notifications/notify-core", () => ({ sendScheduledNotificationCore: vi.fn() }));

const tokens = await import("@/lib/mcp/tokens");
const oauth = await import("@/lib/mcp/oauth");
const { POST: tokenPOST } = await import("../route");
const { POST: mcpPOST } = await import("@/app/api/mcp/route");
const { processOneScheduledAction } = await import("@/lib/mcp/scheduler-runner");

const USER = "user-1";
let RAW = "";
let ID = "";
let RT = "";

beforeEach(async () => {
  dispatched.mockReset();
  db = makeFakeMcpDb({ mcp_access_tokens: [], mcp_oauth_refresh_tokens: [], mcp_oauth_clients: [], mcp_scheduled_actions: [], profiles: [{ user_id: USER, timezone: "UTC" }] });
  installRefreshGrantEmulation(db);
  const minted = await tokens.createAccessToken(db.client, USER, "OAuth: x", ["read", "write"], { clientKind: "mcp_oauth" });
  if (!minted.ok || !minted.token || !minted.status) throw new Error(minted.message);
  RAW = minted.token;
  ID = minted.status.id;
  const rt = await oauth.mintRefreshToken(db.client, { accessTokenId: ID, clientId: "client-1", userId: USER });
  if (!rt.ok) throw new Error(rt.message);
  RT = rt.refreshToken;
  db.tables.mcp_scheduled_actions.push({
    id: "sched-1", user_id: USER, token_id: ID, tool_name: "write",
    args: { domain: "deen", entity: "prayer", action: "log", patch: {} },
    cron_expression: null, run_at: new Date(Date.now() + 86_400_000).toISOString(), next_run_at: new Date().toISOString(),
    status: "active", attempt_count: 0,
  });

  // Positive control: every path accepts the token while it is LIVE, so the
  // assertions below fail for revocation, not because the fixture is broken.
  expect(await tokens.verifyAccessToken(db.client, RAW)).not.toBeNull();
  expect(await tokens.getLiveTokenById(db.client, ID)).not.toBeNull();

  await tokens.revokeAccessToken(db.client, USER, ID);
  expect(db.tables.mcp_access_tokens[0].revoked_at).toBeTruthy();
});

const liveCount = () => db.tables.mcp_access_tokens.filter((t) => !t.revoked_at).length;

describe("P4-11 (e): a revoked access token is dead on every load path", () => {
  it("verifyAccessToken (by hash) -> null", async () => {
    expect(await tokens.verifyAccessToken(db.client, RAW)).toBeNull();
  });

  it("POST /api/mcp with it as the bearer -> 401, no tool runs", async () => {
    const res = await mcpPOST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${RAW}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
      }),
    );
    expect(res.status).toBe(401);
    expect(dispatched).not.toHaveBeenCalled();

    // Control: the same request with a LIVE token is not a 401, so the 401 above is the revocation.
    const live = await tokens.createAccessToken(db.client, USER, "live", ["read"]);
    const ok = await mcpPOST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${live.token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
      }),
    );
    expect(ok.status).not.toBe(401);
  });

  it("getLiveTokenById (by id) -> null, and the scheduled fire is denied and paused", async () => {
    expect(await tokens.getLiveTokenById(db.client, ID)).toBeNull();
    const row = db.tables.mcp_scheduled_actions[0];
    expect(await processOneScheduledAction(db.client, { ...row } as never, new Date())).toBe("denied");
    expect(dispatched).not.toHaveBeenCalled();
    expect(db.tables.mcp_scheduled_actions[0].status).toBe("paused");
  });

  it("refresh grant with its own unused refresh token -> invalid_grant, no new live token, schedule not moved", async () => {
    const res = await tokenPOST(
      new Request("https://x.test/api/mcp/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: RT }).toString(),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
    expect(liveCount()).toBe(0);
    expect(db.tables.mcp_scheduled_actions[0].token_id).toBe(ID);
  });

  it("findAccessTokenForRefreshToken may return the mapping (reuse detection needs it), but it never leads to a grant", async () => {
    const found = await oauth.findAccessTokenForRefreshToken(db.client, RT);
    expect(found?.accessTokenId).toBe(ID);
    expect(await tokens.getLiveTokenById(db.client, found!.accessTokenId)).toBeNull();
  });

  it("createAccessToken's cap count does not count it", async () => {
    // 19 more live tokens + the revoked one = 20 rows, but only 19 live: a 20th live one is allowed.
    for (let i = 0; i < 19; i++) {
      const r = await tokens.createAccessToken(db.client, USER, `t${i}`, ["read"]);
      expect(r.ok).toBe(true);
    }
    expect((await tokens.createAccessToken(db.client, USER, "20th live", ["read"])).ok).toBe(true);
    expect((await tokens.createAccessToken(db.client, USER, "21st live", ["read"])).ok).toBe(false);
  });

  it("touchLastUsed does not stamp last_used_at on a revoked token", async () => {
    await tokens.touchLastUsed(db.client, ID);
    expect(db.tables.mcp_access_tokens[0].last_used_at ?? null).toBeNull();
  });
});
