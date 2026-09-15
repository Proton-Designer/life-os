import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { makeFakeMcpDb, type FakeMcpDb } from "@/lib/scheduling/__tests__/fake-mcp-tables";

/**
 * P4-11 security fix — reproduces p4-b-parity's live verification failure
 * (production, deploy 8757b90) step for step:
 *
 *   A + R1 issued; a schedule created under A
 *   refresh R1           -> B + R2, schedule re-pointed A -> B
 *   replay R1            -> reuse detected, B revoked
 *   refresh R2 (sibling) -> WAS 200 + a fresh live token C, and the handoff
 *                           moved the stolen chain's schedule onto C (active)
 *
 * Everything OAuth- and token-shaped here is REAL code against one in-memory
 * DB: rotateRefreshToken, mintRefreshToken, findAccessTokenForRefreshToken,
 * findLiveAccessTokenIdsForClient, createAccessToken, revokeAccessToken,
 * getTokenScopesById, getLiveTokenById, the re-point helper and
 * processOneScheduledAction. Stubbed only: GoTrue's active-user check, the
 * audit insert, and the write dispatch itself (executeOperation).
 */

let db: FakeMcpDb;
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => db.client) }));
vi.mock("@/lib/mcp/active-user", () => ({ isUserActive: vi.fn(async () => true) }));
vi.mock("@/lib/mcp/audit", () => ({ writeAuditRow: vi.fn(async () => {}) }));
const dispatched = vi.fn<(tokenId: unknown) => void>();
vi.mock("@/lib/agent-api/execute", () => ({
  executeOperation: async (_s: unknown, auth: { extra: { tokenId: string } }) => {
    dispatched(auth.extra.tokenId);
    const toolResult: CallToolResult = { content: [{ type: "text", text: "{}" }] };
    return { ok: true, data: null, text: "{}", summary: "ok", toolResult };
  },
}));
vi.mock("@/lib/notifications/notify-core", () => ({ sendScheduledNotificationCore: vi.fn() }));

const { POST } = await import("../route");
const { processOneScheduledAction } = await import("@/lib/mcp/scheduler-runner");
const { createAccessToken, revokeAccessToken } = await import("@/lib/mcp/tokens");
const { mintRefreshToken } = await import("@/lib/mcp/oauth");

const USER = "user-1";
const CLIENT = "client-1";

function refresh(rt: string) {
  return POST(
    new Request("https://lifeos.example.com/api/mcp/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt }).toString(),
    }),
  );
}

function tokenIdOf(raw: string): string {
  // createAccessToken returned the row id alongside the raw token; tests keep that mapping.
  const id = rawToId.get(raw);
  if (!id) throw new Error(`unknown raw token ${raw}`);
  return id;
}
const rawToId = new Map<string, string>();

async function issueInitial(): Promise<{ accessTokenId: string; refreshToken: string }> {
  const minted = await createAccessToken(db.client, USER, "OAuth: P4 verify", ["read", "write"], { clientKind: "mcp_oauth" });
  if (!minted.ok || !minted.status || !minted.token) throw new Error(minted.message);
  rawToId.set(minted.token, minted.status.id);
  const rt = await mintRefreshToken(db.client, { accessTokenId: minted.status.id, clientId: CLIENT, userId: USER });
  if (!rt.ok) throw new Error(rt.message);
  return { accessTokenId: minted.status.id, refreshToken: rt.refreshToken };
}

function liveTokens() {
  return db.tables.mcp_access_tokens.filter((t) => t.user_id === USER && !t.revoked_at);
}

async function fire() {
  const row = db.tables.mcp_scheduled_actions[0];
  return processOneScheduledAction(db.client, { ...row } as never, new Date());
}

beforeEach(() => {
  dispatched.mockReset();
  rawToId.clear();
  db = makeFakeMcpDb({
    mcp_access_tokens: [],
    mcp_oauth_refresh_tokens: [],
    mcp_oauth_clients: [],
    mcp_scheduled_actions: [],
    profiles: [{ user_id: USER, timezone: "America/Chicago" }],
  });
});

async function scheduleUnder(tokenId: string) {
  db.tables.mcp_scheduled_actions.push({
    id: "sched-1",
    user_id: USER,
    token_id: tokenId,
    tool_name: "write",
    args: { domain: "deen", entity: "prayer", action: "log", patch: {} },
    cron_expression: null,
    run_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    next_run_at: new Date().toISOString(),
    status: "active",
    attempt_count: 0,
  });
}

describe("P4-11 security: a reuse-detected chain cannot be revived through a sibling refresh token", () => {
  it("replay R1 after A->B, then refresh with R2: refused, no new live token, schedule stays on B and is denied", async () => {
    const { accessTokenId: A, refreshToken: R1 } = await issueInitial();
    await scheduleUnder(A);

    // 1. Legitimate refresh: A -> B, R2 issued, schedule follows.
    const r1 = await refresh(R1);
    expect(r1.status).toBe(200);
    const body1 = (await r1.json()) as { access_token: string; refresh_token: string };
    const R2 = body1.refresh_token;
    const B = db.tables.mcp_scheduled_actions[0].token_id as string;
    expect(B).not.toBe(A);
    expect(liveTokens().map((t) => t.id)).toEqual([B]);

    // 2. Replay R1 -> reuse detected, B revoked.
    const replay = await refresh(R1);
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe("invalid_grant");
    expect(liveTokens()).toHaveLength(0);

    // 3. The sibling R2 must not work any more.
    const sibling = await refresh(R2);
    expect(sibling.status).toBe(400); // before the fix: 200 + a live token C
    expect((await sibling.json()).error).toBe("invalid_grant");
    expect(liveTokens()).toHaveLength(0);
    expect(db.tables.mcp_scheduled_actions[0].token_id).toBe(B);

    expect(await fire()).toBe("denied");
    expect(dispatched).not.toHaveBeenCalled();
    expect(db.tables.mcp_scheduled_actions[0].status).toBe("paused");
  });

  it("reuse detection burns EVERY unused refresh token for that (user, client), not just the replayed one", async () => {
    const { refreshToken: R1 } = await issueInitial();
    await refresh(R1); // -> R2 (unused)
    // A second, parallel connection of the same client (double-connect) -> R3 (unused)
    await issueInitial();
    expect(db.tables.mcp_oauth_refresh_tokens.filter((r) => !r.rotated_at)).toHaveLength(2);

    await refresh(R1); // replay -> theft signal

    expect(db.tables.mcp_oauth_refresh_tokens.filter((r) => r.client_id === CLIENT && r.user_id === USER && !r.rotated_at)).toHaveLength(0);
  });

  it("a refresh token whose access token was REVOKED (e.g. from Settings) is refused, and nothing is re-pointed", async () => {
    const { accessTokenId: A, refreshToken: R1 } = await issueInitial();
    await scheduleUnder(A);
    await revokeAccessToken(db.client, USER, A);

    const res = await refresh(R1);
    expect(res.status).toBe(400); // before the fix: 200 + a fresh live token
    expect((await res.json()).error).toBe("invalid_grant");
    expect(liveTokens()).toHaveLength(0);
    expect(db.tables.mcp_scheduled_actions[0].token_id).toBe(A);
  });

  it("an EXPIRED-but-not-revoked access token stays refreshable (P4-12's normal refresh path)", async () => {
    const { accessTokenId: A, refreshToken: R1 } = await issueInitial();
    await scheduleUnder(A);
    const rowA = db.tables.mcp_access_tokens.find((t) => t.id === A)!;
    rowA.created_at = new Date(Date.now() - 31 * 86_400_000).toISOString();
    rowA.expires_at = new Date(Date.now() - 86_400_000).toISOString();
    expect(await fire()).toBe("denied"); // expired A no longer authorizes its schedule...
    db.tables.mcp_scheduled_actions[0].status = "active";

    const res = await refresh(R1);
    expect(res.status).toBe(200); // ...but refreshing it is exactly what a client should do
    const B = db.tables.mcp_scheduled_actions[0].token_id as string;
    expect(B).not.toBe(A);
    expect(liveTokens().map((t) => t.id)).toEqual([B]);
    expect(await fire()).toBe("ok");
  });
});

describe("P4-13 nit (folded in): token-route 500s never echo internal error text", () => {
  it("a failed schedule re-point returns a generic server_error description", async () => {
    const { accessTokenId: A, refreshToken: R1 } = await issueInitial();
    await scheduleUnder(A);
    db.failOn.add("mcp_scheduled_actions:update");
    db.failMessage["mcp_scheduled_actions:update"] = 'relation "mcp_scheduled_actions" violates constraint secret_internal_name';

    const res = await refresh(R1);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("server_error");
    expect(body.error_description).not.toMatch(/secret_internal_name|relation|constraint/);
  });
});

void tokenIdOf;
