import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { makeFakeMcpDb, type FakeMcpDb } from "@/lib/scheduling/__tests__/fake-mcp-tables";

/**
 * P4-11 — the whole path, not the call shape: a schedule created under OAuth
 * access token A must still FIRE after the client refreshes to token B, and a
 * refresh-token REUSE (theft signal) must leave the stolen chain's schedules
 * denied.
 *
 * Real code under test: the token route's refresh branch, the real
 * `revokeAccessToken` / `getTokenScopesById` / `getLiveTokenById`, the real
 * re-point helper, the real `findLiveAccessTokenIdsForClient`, and the real
 * `processOneScheduledAction` — all against one in-memory DB. Stubbed: only
 * what needs hashing/crypto or a network (refresh-token rotation lookup,
 * minting a token string, GoTrue active check, the audit insert, and
 * runMcpTool's actual write dispatch).
 */

let db: FakeMcpDb;
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => db.client) }));

const rotateRefreshToken = vi.fn();
const findAccessTokenForRefreshToken = vi.fn();
vi.mock("@/lib/mcp/oauth", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/mcp/oauth")>();
  return {
    ...actual,
    rotateRefreshToken: (...a: unknown[]) => rotateRefreshToken(...a),
    findAccessTokenForRefreshToken: (...a: unknown[]) => findAccessTokenForRefreshToken(...a),
    mintRefreshToken: vi.fn(async () => ({ ok: true, refreshToken: "lifeos_oauthrefresh_next" })),
    getOAuthClient: vi.fn(async () => ({ client_id: "cid", client_name: "Claude", redirect_uris: [], created_at: "2026-09-01T00:00:00Z" })),
  };
});

let nextTokenId = "tok-B";
vi.mock("@/lib/mcp/tokens", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/mcp/tokens")>();
  return {
    ...actual,
    // Stubbed only because the real one generates + hashes a secret; it
    // still writes a real row the rest of the flow reads back.
    createAccessToken: vi.fn(async (_s: unknown, userId: string, label: string, scopes: string[], opts?: { expiresAt?: string | null; clientKind?: string }) => {
      db.tables.mcp_access_tokens.push({ id: nextTokenId, user_id: userId, label, scopes, revoked_at: null, expires_at: opts?.expiresAt ?? null, client_kind: opts?.clientKind ?? "pat" });
      return { ok: true, message: "ok", token: `lifeos_pat_${nextTokenId}`, status: { id: nextTokenId, scopes } };
    }),
  };
});

vi.mock("@/lib/mcp/active-user", () => ({ isUserActive: vi.fn(async () => true) }));
vi.mock("@/lib/mcp/audit", () => ({ writeAuditRow: vi.fn(async () => {}) }));
const runMcpTool = vi.fn<(...a: unknown[]) => Promise<CallToolResult>>();
vi.mock("@/lib/mcp/tool-wrapper", () => ({ runMcpTool: (...a: unknown[]) => runMcpTool(...a) }));
// The runner dispatches via executeOperation (P4-12, transport "scheduler"); adapt it to runMcpTool's positional shape.
vi.mock("@/lib/agent-api/execute", () => ({
  executeOperation: async (s: unknown, auth: unknown, op: { toolName: string; operation: string; requiredScope: string; args: unknown; run: unknown }) => {
    const r = await runMcpTool(s, auth, op.toolName, op.operation, op.requiredScope, op.args, op.run);
    return r.isError ? { ok: false, code: "internal", status: 500, message: "error" } : { ok: true, data: null, text: "", summary: "", toolResult: r };
  },
}));
vi.mock("@/lib/notifications/notify-core", () => ({ sendScheduledNotificationCore: vi.fn() }));

const { POST } = await import("../route");
const { processOneScheduledAction } = await import("@/lib/mcp/scheduler-runner");

const now = new Date("2026-09-15T14:00:00.000Z");

function refreshRequest(rt: string) {
  return new Request("https://lifeos.example.com/api/mcp/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt }).toString(),
  });
}

function scheduleRow() {
  return {
    id: "sched-1",
    user_id: "user-1",
    token_id: "tok-A",
    tool_name: "write",
    args: { domain: "settings", entity: "profile", action: "update", patch: { theme_preset: "ocean" } },
    cron_expression: null,
    run_at: "2026-09-15T14:00:00.000Z",
    next_run_at: "2026-09-15T14:00:00.000Z",
    status: "active",
    attempt_count: 0,
  };
}

/** Fires the schedule the way the cron runner does: reads the stored row, then processes it. */
async function fire() {
  const row = db.tables.mcp_scheduled_actions.find((r) => r.id === "sched-1")!;
  return processOneScheduledAction(db.client, { ...row } as never, now);
}

beforeEach(() => {
  nextTokenId = "tok-B";
  rotateRefreshToken.mockReset();
  findAccessTokenForRefreshToken.mockReset();
  runMcpTool.mockReset();
  runMcpTool.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
  db = makeFakeMcpDb({
    mcp_access_tokens: [{ id: "tok-A", user_id: "user-1", label: "OAuth: Claude", scopes: ["read", "write"], revoked_at: null }],
    mcp_scheduled_actions: [scheduleRow()],
    mcp_oauth_refresh_tokens: [{ id: "rt-1", user_id: "user-1", client_id: "cid", access_token_id: "tok-A", rotated_at: null }],
    profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
  });
});

describe("P4-11: scheduled actions survive a legitimate OAuth refresh", () => {
  it("a schedule created under token A fires under token B after the client refreshes", async () => {
    rotateRefreshToken.mockResolvedValueOnce({ ok: true, userId: "user-1", clientId: "cid", oldAccessTokenId: "tok-A" });

    const res = await POST(refreshRequest("rt-live"));
    expect(res.status).toBe(200);

    const tokA = db.tables.mcp_access_tokens.find((t) => t.id === "tok-A")!;
    expect(tokA.revoked_at).not.toBeNull(); // rotation still revokes the old credential

    const outcome = await fire();
    expect(outcome).toBe("ok"); // before P4-11: "denied", row paused
    expect(db.tables.mcp_scheduled_actions[0].token_id).toBe("tok-B");
    expect(runMcpTool).toHaveBeenCalledWith(
      db.client,
      { scopes: ["read", "write"], extra: { userId: "user-1", tokenId: "tok-B" } },
      "write",
      "settings.profile.update",
      "write",
      expect.anything(),
      expect.any(Function),
    );
    expect(db.tables.mcp_scheduled_actions[0].status).not.toBe("paused");
  });

  it("never re-points another user's schedules that happen to reference the same token id", async () => {
    db.tables.mcp_scheduled_actions.push({ ...scheduleRow(), id: "sched-other", user_id: "user-2" });
    rotateRefreshToken.mockResolvedValueOnce({ ok: true, userId: "user-1", clientId: "cid", oldAccessTokenId: "tok-A" });
    await POST(refreshRequest("rt-live"));
    expect(db.tables.mcp_scheduled_actions.find((r) => r.id === "sched-other")!.token_id).toBe("tok-A");
  });

  it("if the re-point fails, the refresh fails closed: old token stays live, new token is revoked, schedules still fire", async () => {
    db.failOn.add("mcp_scheduled_actions:update");
    rotateRefreshToken.mockResolvedValueOnce({ ok: true, userId: "user-1", clientId: "cid", oldAccessTokenId: "tok-A" });

    const res = await POST(refreshRequest("rt-live"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("server_error");
    expect(db.tables.mcp_access_tokens.find((t) => t.id === "tok-A")!.revoked_at).toBeNull();
    expect(db.tables.mcp_access_tokens.find((t) => t.id === "tok-B")!.revoked_at).not.toBeNull();

    db.failOn.delete("mcp_scheduled_actions:update");
    expect(await fire()).toBe("ok");
  });
});

describe("P4-12: expiry reaches scheduled fires", () => {
  it("a schedule whose token has EXPIRED is denied at fire time, exactly like a revoked one", async () => {
    // getLiveTokenById compares against the real wall clock (not this file's fixed `now`).
    db.tables.mcp_access_tokens[0].expires_at = new Date(Date.now() - 60_000).toISOString();
    expect(await fire()).toBe("denied");
    expect(runMcpTool).not.toHaveBeenCalled();
  });

  it("the token minted by a refresh carries a 30-day expiry and kind mcp_oauth, and schedules fire under it", async () => {
    rotateRefreshToken.mockResolvedValueOnce({ ok: true, userId: "user-1", clientId: "cid", oldAccessTokenId: "tok-A" });
    const res = await POST(refreshRequest("rt-live"));
    expect((await res.json()).expires_in).toBe(2_592_000);
    const tokB = db.tables.mcp_access_tokens.find((t) => t.id === "tok-B")!;
    expect(tokB.client_kind).toBe("mcp_oauth");
    expect(Date.parse(tokB.expires_at as string)).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(await fire()).toBe("ok");
  });
});

describe("P4-11: refresh-token REUSE does not rescue the stolen chain", () => {
  it("reuse detection revokes the live token and does NOT re-point: the schedule stays denied", async () => {
    // Attacker redeemed first: A -> B legitimately-looking rotation already happened.
    rotateRefreshToken.mockResolvedValueOnce({ ok: true, userId: "user-1", clientId: "cid", oldAccessTokenId: "tok-A" });
    db.tables.mcp_oauth_refresh_tokens[0].rotated_at = now.toISOString();
    await POST(refreshRequest("rt-1"));
    db.tables.mcp_oauth_refresh_tokens.push({ id: "rt-2", user_id: "user-1", client_id: "cid", access_token_id: "tok-B", rotated_at: null });
    expect(db.tables.mcp_scheduled_actions[0].token_id).toBe("tok-B");

    // The legitimate holder replays rt-1 -> theft signal.
    rotateRefreshToken.mockResolvedValueOnce({ ok: false, error: "invalid_grant", message: "reused", reuseDetected: true });
    findAccessTokenForRefreshToken.mockResolvedValueOnce({ accessTokenId: "tok-A", userId: "user-1", clientId: "cid" });
    nextTokenId = "tok-C-must-not-exist";

    const res = await POST(refreshRequest("rt-1"));
    expect(res.status).toBe(400);
    expect(db.tables.mcp_access_tokens.find((t) => t.id === "tok-B")!.revoked_at).not.toBeNull();
    expect(db.tables.mcp_access_tokens.some((t) => t.id === "tok-C-must-not-exist")).toBe(false);
    expect(db.tables.mcp_scheduled_actions[0].token_id).toBe("tok-B"); // not moved anywhere

    expect(await fire()).toBe("denied");
    expect(runMcpTool).not.toHaveBeenCalled();
    expect(db.tables.mcp_scheduled_actions[0]).toMatchObject({ status: "paused", last_outcome: "denied" });
  });
});
