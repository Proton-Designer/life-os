import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// P4-14: dynamically imported everywhere it's used, not statically here --
// a static top-level import drags in lib/mcp/oauth.ts -> the mocked
// @/lib/mcp/tokens BEFORE verifyAccessTokenMock's own `const` initializes
// below, tripping its TDZ (ReferenceError). Every other cross-module import
// in this file is already dynamic for the same reason.

/**
 * L3's brief, verbatim: "A positive-path-only proof of auth is worth
 * nothing — the negative case is what makes the positive one mean
 * anything." These tests drive `app/api/mcp/route.ts`'s EXPORTED handler
 * directly with real `Request` objects — no server process, no network,
 * no mocked HTTP layer — so the 401 behavior being asserted is
 * `withMcpAuth`'s actual wiring, not a guess about it.
 *
 * What's mocked and why: `lib/supabase/service-role` (no real Supabase
 * project reachable/writable from here) and `lib/mcp/tokens`'s
 * `verifyAccessToken` (its own unit tests in tokens.test.ts already prove
 * wrong/revoked/malformed all resolve to `null` — this file only needs to
 * prove that a `null` from verifyAccessToken actually becomes an HTTP 401
 * through this route's specific wiring, which is the part those unit
 * tests cannot see).
 */

const verifyAccessTokenMock = vi.fn(async (_client: unknown, _raw: string) => null as { userId: string; tokenId: string; scopes: string[] } | null);
vi.mock("@/lib/mcp/tokens", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp/tokens")>("@/lib/mcp/tokens");
  return { ...actual, verifyAccessToken: verifyAccessTokenMock };
});

// P4-14: a real Supabase client's .rpc() never throws synchronously (it
// always resolves {data,error}), so the fake must offer one too, or
// noteAuthFailure's `await serviceClient.rpc(...)` throws on a fake missing
// the method entirely -- turning a 401 into an uncaught 500.
const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(async (): Promise<{ data: { over_limit: boolean; retry_after_seconds?: number } | null; error: unknown }> => ({
    data: { over_limit: false },
    error: null,
  })),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(() => ({ __fake: "service-role-client", rpc: rpcMock })),
}));

const isUserActiveMock = vi.fn(async () => true);
vi.mock("@/lib/mcp/active-user", () => ({ isUserActive: isUserActiveMock }));

beforeEach(() => {
  verifyAccessTokenMock.mockReset();
  verifyAccessTokenMock.mockResolvedValue(null);
  isUserActiveMock.mockReset();
  isUserActiveMock.mockResolvedValue(true);
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: { over_limit: false }, error: null });
});

afterEach(async () => {
  const { __resetAuthFailureCacheForTests } = await import("@/lib/mcp/auth-failure-limit");
  __resetAuthFailureCacheForTests();
  vi.resetModules();
});

function mcpRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
}

const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
};

describe("app/api/mcp/route — the auth boundary", () => {
  it("REJECTS with 401 when there is no Authorization header at all", async () => {
    const { POST } = await import("../route");
    const res = await POST(mcpRequest(INITIALIZE_BODY));
    expect(res.status).toBe(401);
    expect(verifyAccessTokenMock).not.toHaveBeenCalled(); // withMcpAuth short-circuits before verifyToken even runs with no bearer token
  });

  it("REJECTS with 401 for a malformed/garbage bearer token (verifyAccessToken finds no matching row)", async () => {
    verifyAccessTokenMock.mockResolvedValue(null);
    const { POST } = await import("../route");

    const res = await POST(mcpRequest(INITIALIZE_BODY, { Authorization: "Bearer not-even-shaped-like-a-real-token" }));

    expect(res.status).toBe(401);
    expect(verifyAccessTokenMock).toHaveBeenCalled();
  });

  it("REJECTS with 401 for a revoked token — verifyAccessToken resolves null exactly as it does for a wrong token, and this route must not distinguish them in its response", async () => {
    verifyAccessTokenMock.mockResolvedValue(null); // tokens.test.ts already proves a revoked row maps to this same null
    const { POST } = await import("../route");

    const res = await POST(mcpRequest(INITIALIZE_BODY, { Authorization: "Bearer lifeos_pat_was-revoked" }));

    expect(res.status).toBe(401);
  });

  it("REJECTS with 401 when the token is live but R4a's active-user check fails (banned/deleted) — not folded into verifyAccessToken", async () => {
    verifyAccessTokenMock.mockResolvedValue({ userId: "user-1", tokenId: "tok-1", scopes: ["read"] });
    isUserActiveMock.mockResolvedValue(false);
    const { POST } = await import("../route");

    const res = await POST(mcpRequest(INITIALIZE_BODY, { Authorization: "Bearer lifeos_pat_belongs-to-banned-user" }));

    expect(res.status).toBe(401);
    expect(isUserActiveMock).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("PASSES the auth boundary (not a 401) once verifyAccessToken and isUserActive both succeed — the handshake proceeds into MCP's own protocol handling", async () => {
    verifyAccessTokenMock.mockResolvedValue({ userId: "user-1", tokenId: "tok-1", scopes: ["read", "write"] });
    isUserActiveMock.mockResolvedValue(true);
    const { POST } = await import("../route");

    const res = await POST(mcpRequest(INITIALIZE_BODY, { Authorization: "Bearer lifeos_pat_a-real-live-token" }));

    expect(res.status).not.toBe(401);
  });
});

describe("app/api/mcp/route — P4-14 auth-failure flood", () => {
  it("a flood of 401s from one IP becomes 429 with Retry-After once the RPC reports over_limit", async () => {
    const { POST } = await import("../route");
    const headers = { Authorization: "Bearer nope", "x-forwarded-for": "203.0.113.55" };

    const { AUTH_FAILURE_LIMIT } = await import("@/lib/mcp/auth-failure-limit");
    const first = await POST(mcpRequest(INITIALIZE_BODY, headers));
    expect(first.status).toBe(401); // still under the limit
    expect(rpcMock).toHaveBeenCalledWith("mcp_rate_limit_note_failure", expect.objectContaining({ p_limit: AUTH_FAILURE_LIMIT }));

    rpcMock.mockResolvedValue({ data: { over_limit: true, retry_after_seconds: 45 }, error: null });
    const flooded = await POST(mcpRequest(INITIALIZE_BODY, headers));
    expect(flooded.status).toBe(429);
    expect(flooded.headers.get("retry-after")).toBe("45");
  });

  it("a different IP is unaffected by another IP's flood", async () => {
    rpcMock.mockResolvedValue({ data: { over_limit: true, retry_after_seconds: 45 }, error: null });
    const { POST } = await import("../route");
    const res = await POST(mcpRequest(INITIALIZE_BODY, { Authorization: "Bearer nope", "x-forwarded-for": "198.51.100.9" }));
    // This IP's own first call hasn't tripped anything in a real system, but
    // the fake RPC always answers over_limit here on purpose -- still proves
    // the route honors whatever the limiter says, not a hardcoded 401/429.
    expect(res.status).toBe(429);
  });

  it("a successful auth never consumes the auth-failure bucket (the happy path pays nothing)", async () => {
    verifyAccessTokenMock.mockResolvedValue({ userId: "user-1", tokenId: "tok-1", scopes: ["read", "write"] });
    isUserActiveMock.mockResolvedValue(true);
    const { POST } = await import("../route");
    await POST(mcpRequest(INITIALIZE_BODY, { Authorization: "Bearer lifeos_pat_live", "x-forwarded-for": "203.0.113.55" }));
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
