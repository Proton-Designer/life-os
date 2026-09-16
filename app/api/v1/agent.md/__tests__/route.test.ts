import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => "service-client-marker") }));

const verifyAccessToken = vi.fn();
const listAccessTokens = vi.fn();
vi.mock("@/lib/mcp/tokens", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/mcp/tokens")>()),
  verifyAccessToken: (...args: unknown[]) => verifyAccessToken(...args),
  listAccessTokens: (...args: unknown[]) => listAccessTokens(...args),
}));

const isUserActive = vi.fn();
vi.mock("@/lib/mcp/active-user", () => ({ isUserActive: (...args: unknown[]) => isUserActive(...args) }));

const consumeRateLimit = vi.fn();
vi.mock("@/lib/mcp/rate-limit", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/mcp/rate-limit")>()),
  consumeRateLimit: (...args: unknown[]) => consumeRateLimit(...args),
}));

const noteAuthFailure = vi.fn();
vi.mock("@/lib/mcp/auth-failure-limit", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/mcp/auth-failure-limit")>()),
  noteAuthFailure: (...args: unknown[]) => noteAuthFailure(...args),
}));

vi.mock("@/lib/mcp/session", () => ({
  mintSessionJwt: vi.fn(async () => "fake.jwt"),
  buildUserScopedClient: vi.fn(() => "user-client-marker"),
}));

const buildAccountMap = vi.fn();
vi.mock("@/lib/agent-api/account-map", () => ({ buildAccountMap: (...args: unknown[]) => buildAccountMap(...args) }));

import { GET } from "../route";

const VERIFIED = { userId: "user-1", tokenId: "tok-1", scopes: ["read"] };
const MAP = { today: { local_date: "2026-09-16", timezone: "UTC", local_time: "12:00" }, mode: "legacy", active_areas: [], vocabulary_map: {}, domains: {}, next: "" };

function req(headers: Record<string, string> = {}) {
  return new Request("https://lifeos.example.com/api/v1/agent.md", { headers });
}

beforeEach(() => {
  verifyAccessToken.mockReset();
  listAccessTokens.mockReset();
  isUserActive.mockReset();
  isUserActive.mockResolvedValue(true);
  consumeRateLimit.mockReset();
  consumeRateLimit.mockResolvedValue({ ok: true });
  noteAuthFailure.mockReset();
  noteAuthFailure.mockResolvedValue({ limited: false });
  buildAccountMap.mockReset();
  buildAccountMap.mockResolvedValue(MAP);
  listAccessTokens.mockResolvedValue([{ id: "tok-1", expiresAt: null }]);
});

describe("GET /api/v1/agent.md", () => {
  it("401s with no token, and never calls buildAccountMap", async () => {
    const response = await GET(req());
    expect(response.status).toBe(401);
    expect(buildAccountMap).not.toHaveBeenCalled();
  });

  it("400s a token passed in the query string, before auth is even attempted", async () => {
    const response = await GET(new Request("https://lifeos.example.com/api/v1/agent.md?access_token=lifeos_pat_x"));
    expect(response.status).toBe(400);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it("401s an unverifiable token", async () => {
    verifyAccessToken.mockResolvedValueOnce(null);
    const response = await GET(req({ Authorization: "Bearer bad" }));
    expect(response.status).toBe(401);
  });

  it("401s once the auth-failure limiter trips, as a 429 instead", async () => {
    verifyAccessToken.mockResolvedValueOnce(null);
    noteAuthFailure.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 20 });
    const response = await GET(req({ Authorization: "Bearer bad" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("20");
  });

  it("403s a write-only-scoped token (read is required to fetch a doc)", async () => {
    verifyAccessToken.mockResolvedValueOnce({ userId: "user-1", tokenId: "tok-1", scopes: ["write"] });
    const response = await GET(req({ Authorization: "Bearer lifeos_pat_x" }));
    expect(response.status).toBe(403);
    expect(buildAccountMap).not.toHaveBeenCalled();
  });

  it("429s over the shared interactive rate limit, without ever building the map", async () => {
    verifyAccessToken.mockResolvedValueOnce(VERIFIED);
    consumeRateLimit.mockResolvedValueOnce({ ok: false, message: "Rate limit exceeded.", retryAfterSeconds: 5 });
    const response = await GET(req({ Authorization: "Bearer lifeos_pat_x" }));
    expect(response.status).toBe(429);
    expect(buildAccountMap).not.toHaveBeenCalled();
  });

  it("on success: renders markdown from buildAccountMap's own map, scoped by this token's own scopes/expiry", async () => {
    verifyAccessToken.mockResolvedValueOnce(VERIFIED);
    listAccessTokens.mockResolvedValueOnce([{ id: "tok-1", expiresAt: "2026-12-01T00:00:00.000Z" }]);
    const response = await GET(req({ Authorization: "Bearer lifeos_pat_x" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(consumeRateLimit).toHaveBeenCalledWith("service-client-marker", { tokenId: "tok-1", userId: "user-1", lane: "interactive" });
    const body = await response.text();
    expect(body).toContain("2026-09-16");
    expect(body).toContain("2026-12-01T00:00:00.000Z");
  });
});
