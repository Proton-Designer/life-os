import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUserMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: (...args: unknown[]) => requireUserMock(...args),
}));

const isWhoopConfiguredMock = vi.fn();
vi.mock("@/lib/whoop/config", () => ({
  isWhoopConfigured: (...args: unknown[]) => isWhoopConfiguredMock(...args),
}));

const exchangeWhoopAuthorizationCodeMock = vi.fn();
vi.mock("@/lib/whoop/client", () => ({
  exchangeWhoopAuthorizationCode: (...args: unknown[]) => exchangeWhoopAuthorizationCodeMock(...args),
}));

const saveWhoopConnectionCoreMock = vi.fn();
vi.mock("@/lib/whoop/connection-core", () => ({
  saveWhoopConnectionCore: (...args: unknown[]) => saveWhoopConnectionCoreMock(...args),
}));

const cookieGetMock = vi.fn();
const cookieDeleteMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGetMock, delete: cookieDeleteMock, set: vi.fn() })),
}));

const { GET } = await import("../route");

const REAL_STATE = "real-state-value-123";

beforeEach(() => {
  requireUserMock.mockReset();
  isWhoopConfiguredMock.mockReset();
  exchangeWhoopAuthorizationCodeMock.mockReset();
  saveWhoopConnectionCoreMock.mockReset();
  cookieGetMock.mockReset();
  cookieDeleteMock.mockReset();
  isWhoopConfiguredMock.mockReturnValue(true);
  requireUserMock.mockResolvedValue({ supabase: {}, userId: "user-1" });
  cookieGetMock.mockReturnValue({ value: REAL_STATE });
});

function callbackUrl(params: Record<string, string>): string {
  const url = new URL("https://app.example.com/api/whoop/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

describe("GET /api/whoop/callback (P3-18)", () => {
  it("FAILS CLOSED when Whoop isn't configured -- checked BEFORE touching the state cookie or query string at all", async () => {
    isWhoopConfiguredMock.mockReturnValue(false);
    const res = await GET(new Request(callbackUrl({ code: "c1", state: REAL_STATE })));
    expect(res.headers.get("location")).toContain("whoop_error=not_configured");
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(cookieGetMock).not.toHaveBeenCalled();
  });

  it("redirects to /login when not authenticated", async () => {
    requireUserMock.mockRejectedValue(new Error("Not authenticated"));
    const res = await GET(new Request(callbackUrl({ code: "c1", state: REAL_STATE })));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("missing code or state aborts before any exchange attempt", async () => {
    const res = await GET(new Request(callbackUrl({ state: REAL_STATE })));
    expect(res.headers.get("location")).toContain("whoop_error=missing_code_or_state");
    expect(exchangeWhoopAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it("STATE MISMATCH (CSRF): a state that doesn't match the cookie aborts before any token exchange", async () => {
    cookieGetMock.mockReturnValue({ value: "cookie-had-a-different-value" });
    const res = await GET(new Request(callbackUrl({ code: "c1", state: "attacker-supplied-state" })));
    expect(res.headers.get("location")).toContain("whoop_error=state_mismatch");
    expect(exchangeWhoopAuthorizationCodeMock).not.toHaveBeenCalled();
    expect(cookieDeleteMock).toHaveBeenCalled(); // the (mismatched) cookie is still consumed, never left lingering
  });

  it("NO state cookie at all (expired/never set) aborts, never trusts the query param alone", async () => {
    cookieGetMock.mockReturnValue(undefined);
    const res = await GET(new Request(callbackUrl({ code: "c1", state: REAL_STATE })));
    expect(res.headers.get("location")).toContain("whoop_error=state_mismatch");
    expect(exchangeWhoopAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it("a failed token exchange redirects with an error, never calls saveWhoopConnectionCore", async () => {
    exchangeWhoopAuthorizationCodeMock.mockResolvedValue({ ok: false, message: "Whoop rejected that authorization." });
    const res = await GET(new Request(callbackUrl({ code: "c1", state: REAL_STATE })));
    expect(res.headers.get("location")).toContain("whoop_error=exchange_failed");
    expect(saveWhoopConnectionCoreMock).not.toHaveBeenCalled();
  });

  it("happy path: exchanges the code, saves the connection, deletes the state cookie, redirects to Settings with a success flag", async () => {
    const tokenSet = { accessToken: "at", refreshToken: "rt", expiresAt: "2026-09-16T00:00:00Z", scope: "offline" };
    exchangeWhoopAuthorizationCodeMock.mockResolvedValue({ ok: true, data: tokenSet });
    saveWhoopConnectionCoreMock.mockResolvedValue(undefined);

    const res = await GET(new Request(callbackUrl({ code: "real-code", state: REAL_STATE })));

    expect(exchangeWhoopAuthorizationCodeMock).toHaveBeenCalledWith("real-code", "https://app.example.com/api/whoop/callback");
    expect(saveWhoopConnectionCoreMock).toHaveBeenCalledWith({}, "user-1", tokenSet);
    expect(cookieDeleteMock).toHaveBeenCalledWith("whoop_oauth_state");
    expect(res.headers.get("location")).toContain("whoop_connected=1");
  });

  it("a save failure (e.g. DB error) redirects with an error rather than a false success", async () => {
    exchangeWhoopAuthorizationCodeMock.mockResolvedValue({ ok: true, data: { accessToken: "at", refreshToken: "rt", expiresAt: "2026-09-16T00:00:00Z", scope: "offline" } });
    saveWhoopConnectionCoreMock.mockRejectedValue(new Error("db down"));

    const res = await GET(new Request(callbackUrl({ code: "c1", state: REAL_STATE })));

    expect(res.headers.get("location")).toContain("whoop_error=save_failed");
  });
});
