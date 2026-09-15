import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { makeFakeMcpDb, type FakeMcpDb } from "@/lib/scheduling/__tests__/fake-mcp-tables";
import { installRefreshGrantEmulation } from "@/lib/scheduling/__tests__/fake-refresh-grant";

/**
 * P4-11: the whole path, not the call shape. A schedule created under OAuth
 * access token A must still FIRE after the client refreshes to token B, and a
 * refresh-token REUSE (theft signal) must leave the stolen chain's schedules
 * denied.
 *
 * Since P4-13 the grant (rotate, revoke old, mint new, re-point schedules,
 * next refresh token) is ONE SQL transaction: mcp_oauth_refresh_grant,
 * migration 217. Here it runs as its JS mirror (fake-refresh-grant.ts); the
 * SQL is proven on a real Postgres in the P4-13 Log. Real code: the token
 * route, runRefreshGrant, createAccessToken, mintRefreshToken,
 * findAccessTokenForRefreshToken, getLiveTokenById and
 * processOneScheduledAction. Stubbed: GoTrue's active check, the audit insert,
 * and the write dispatch.
 */

let db: FakeMcpDb;
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => db.client) }));
vi.mock("@/lib/mcp/active-user", () => ({ isUserActive: vi.fn(async () => true) }));
vi.mock("@/lib/mcp/audit", () => ({ writeAuditRow: vi.fn(async () => {}) }));
const dispatch = vi.fn<(auth: unknown, op: unknown) => void>();
vi.mock("@/lib/agent-api/execute", () => ({
  executeOperation: async (_s: unknown, auth: unknown, op: { toolName: string; operation: string }) => {
    dispatch(auth, op);
    const toolResult: CallToolResult = { content: [{ type: "text", text: "{}" }] };
    return { ok: true, data: null, text: "{}", summary: "ok", toolResult };
  },
}));
vi.mock("@/lib/notifications/notify-core", () => ({ sendScheduledNotificationCore: vi.fn() }));

const { POST } = await import("../route");
const { processOneScheduledAction } = await import("@/lib/mcp/scheduler-runner");
const { createAccessToken } = await import("@/lib/mcp/tokens");
const { mintRefreshToken } = await import("@/lib/mcp/oauth");

const USER = "user-1";
const CLIENT = "cid";
let A = "";
let R1 = "";

function refresh(rt: string) {
  return POST(
    new Request("https://lifeos.example.com/api/mcp/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt }).toString(),
    }),
  );
}

async function fire() {
  const row = db.tables.mcp_scheduled_actions.find((r) => r.id === "sched-1")!;
  return processOneScheduledAction(db.client, { ...row } as never, new Date());
}

const tokenById = (id: string) => db.tables.mcp_access_tokens.find((t) => t.id === id)!;

beforeEach(async () => {
  dispatch.mockReset();
  db = makeFakeMcpDb({
    mcp_access_tokens: [],
    mcp_oauth_refresh_tokens: [],
    mcp_oauth_clients: [{ client_id: CLIENT, client_name: "Claude", redirect_uris: ["https://claude.ai/cb"], created_at: "2026-09-01T00:00:00Z" }],
    mcp_scheduled_actions: [],
    profiles: [{ user_id: USER, timezone: "America/Chicago" }],
  });
  installRefreshGrantEmulation(db);

  const minted = await createAccessToken(db.client, USER, "OAuth: Claude", ["read", "write"], { clientKind: "mcp_oauth" });
  if (!minted.ok || !minted.status) throw new Error(minted.message);
  A = minted.status.id;
  const rt = await mintRefreshToken(db.client, { accessTokenId: A, clientId: CLIENT, userId: USER });
  if (!rt.ok) throw new Error(rt.message);
  R1 = rt.refreshToken;
  db.tables.mcp_scheduled_actions.push({
    id: "sched-1",
    user_id: USER,
    token_id: A,
    tool_name: "write",
    args: { domain: "settings", entity: "profile", action: "update", patch: { theme_preset: "ocean" } },
    cron_expression: null,
    run_at: new Date(Date.now() + 86_400_000).toISOString(),
    next_run_at: new Date().toISOString(),
    status: "active",
    attempt_count: 0,
  });
});

describe("P4-11: scheduled actions survive a legitimate OAuth refresh", () => {
  it("a schedule created under token A fires under token B after the client refreshes", async () => {
    const res = await refresh(R1);
    expect(res.status).toBe(200);
    expect(tokenById(A).revoked_at).not.toBeNull(); // rotation still revokes the old credential

    const B = db.tables.mcp_scheduled_actions[0].token_id as string;
    expect(B).not.toBe(A);
    expect(await fire()).toBe("ok"); // before P4-11: "denied", row paused
    expect(dispatch).toHaveBeenCalledWith({ scopes: ["read", "write"], extra: { userId: USER, tokenId: B } }, expect.objectContaining({ operation: "settings.profile.update" }));
    expect(db.tables.mcp_scheduled_actions[0].status).not.toBe("paused");
  });

  it("never re-points another user's schedules that happen to reference the same token id", async () => {
    db.tables.mcp_scheduled_actions.push({ ...db.tables.mcp_scheduled_actions[0], id: "sched-other", user_id: "user-2" });
    await refresh(R1);
    expect(db.tables.mcp_scheduled_actions.find((r) => r.id === "sched-other")!.token_id).toBe(A);
  });

  it("if the grant fails, nothing moves: A stays live, the schedule stays on A and still fires, and the 500 is generic", async () => {
    db.failOn.add("rpc:mcp_oauth_refresh_grant");
    const res = await refresh(R1);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("server_error");
    expect(tokenById(A).revoked_at ?? null).toBeNull();
    expect(db.tables.mcp_scheduled_actions[0].token_id).toBe(A);
    expect(await fire()).toBe("ok");
  });
});

describe("P4-12: expiry reaches scheduled fires", () => {
  it("a schedule whose token has EXPIRED is denied at fire time, exactly like a revoked one", async () => {
    tokenById(A).expires_at = new Date(Date.now() - 60_000).toISOString();
    expect(await fire()).toBe("denied");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("the token minted by a refresh carries a 30-day expiry and kind mcp_oauth, and schedules fire under it", async () => {
    const res = await refresh(R1);
    expect((await res.json()).expires_in).toBe(2_592_000);
    const B = tokenById(db.tables.mcp_scheduled_actions[0].token_id as string);
    expect(B.client_kind).toBe("mcp_oauth");
    expect(B.label).toBe("OAuth: Claude");
    expect(Date.parse(B.expires_at as string)).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(await fire()).toBe("ok");
  });
});

describe("P4-11: refresh-token REUSE does not rescue the stolen chain", () => {
  it("reuse detection revokes the live token and does NOT re-point: the schedule stays denied", async () => {
    // Attacker redeems R1 first: A -> B looks like an ordinary rotation.
    await refresh(R1);
    const B = db.tables.mcp_scheduled_actions[0].token_id as string;
    const tokenCountAfterAttack = db.tables.mcp_access_tokens.length;

    // The legitimate holder replays R1 -> theft signal.
    const res = await refresh(R1);
    expect(res.status).toBe(400);
    expect(tokenById(B).revoked_at).not.toBeNull();
    expect(db.tables.mcp_access_tokens).toHaveLength(tokenCountAfterAttack); // nothing new minted
    expect(db.tables.mcp_scheduled_actions[0].token_id).toBe(B); // not moved anywhere

    expect(await fire()).toBe("denied");
    expect(dispatch).not.toHaveBeenCalled();
    expect(db.tables.mcp_scheduled_actions[0]).toMatchObject({ status: "paused", last_outcome: "denied" });
  });
});
