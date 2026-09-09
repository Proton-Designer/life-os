import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(() => ({ __fake: "service-role-client" })),
}));

const isUserActiveMock = vi.fn(async () => true);
vi.mock("@/lib/mcp/active-user", () => ({ isUserActive: isUserActiveMock }));

beforeEach(() => {
  verifyAccessTokenMock.mockReset();
  verifyAccessTokenMock.mockResolvedValue(null);
  isUserActiveMock.mockReset();
  isUserActiveMock.mockResolvedValue(true);
});

afterEach(() => {
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
