import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUserMock = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: (...args: unknown[]) => requireUserMock(...args),
}));

const isWhoopConfiguredMock = vi.fn();
const buildWhoopAuthorizeUrlMock = vi.fn();
vi.mock("@/lib/whoop/config", () => ({
  isWhoopConfigured: (...args: unknown[]) => isWhoopConfiguredMock(...args),
}));
vi.mock("@/lib/whoop/client", () => ({
  buildWhoopAuthorizeUrl: (...args: unknown[]) => buildWhoopAuthorizeUrlMock(...args),
}));

const cookieSetMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: cookieSetMock, get: vi.fn(), delete: vi.fn() })),
}));

const { GET } = await import("../route");

beforeEach(() => {
  requireUserMock.mockReset();
  isWhoopConfiguredMock.mockReset();
  buildWhoopAuthorizeUrlMock.mockReset();
  cookieSetMock.mockReset();
});

describe("GET /api/whoop/authorize (P3-18)", () => {
  it("redirects to /login when not authenticated, never reaching the config check", async () => {
    requireUserMock.mockRejectedValue(new Error("Not authenticated"));
    const res = await GET(new Request("https://app.example.com/api/whoop/authorize"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(isWhoopConfiguredMock).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED when Whoop isn't configured -- redirects to Settings with an error, sets no cookie, builds no authorize URL", async () => {
    requireUserMock.mockResolvedValue({ supabase: {}, userId: "user-1" });
    isWhoopConfiguredMock.mockReturnValue(false);
    const res = await GET(new Request("https://app.example.com/api/whoop/authorize"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("whoop_error=not_configured");
    expect(cookieSetMock).not.toHaveBeenCalled();
    expect(buildWhoopAuthorizeUrlMock).not.toHaveBeenCalled();
  });

  it("when configured: sets an httpOnly state cookie and redirects to the real Whoop authorize URL", async () => {
    requireUserMock.mockResolvedValue({ supabase: {}, userId: "user-1" });
    isWhoopConfiguredMock.mockReturnValue(true);
    buildWhoopAuthorizeUrlMock.mockReturnValue("https://api.prod.whoop.com/oauth/oauth2/auth?client_id=x&state=y");

    const res = await GET(new Request("https://app.example.com/api/whoop/authorize"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://api.prod.whoop.com/oauth/oauth2/auth?client_id=x&state=y");
    expect(cookieSetMock).toHaveBeenCalledTimes(1);
    const [cookieName, cookieValue, cookieOpts] = cookieSetMock.mock.calls[0]!;
    expect(cookieName).toBe("whoop_oauth_state");
    expect(typeof cookieValue).toBe("string");
    expect(cookieValue.length).toBeGreaterThan(20); // a real random value, not a placeholder
    expect(cookieOpts).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });

    // The exact same state value passed to buildWhoopAuthorizeUrl must be
    // the one stored in the cookie -- otherwise the callback could never
    // validate it.
    expect(buildWhoopAuthorizeUrlMock.mock.calls[0]![1]).toBe(cookieValue);
  });

  it("builds the redirect_uri from the request's own origin (works across preview/prod deployments, no hardcoded host)", async () => {
    requireUserMock.mockResolvedValue({ supabase: {}, userId: "user-1" });
    isWhoopConfiguredMock.mockReturnValue(true);
    buildWhoopAuthorizeUrlMock.mockReturnValue("https://api.prod.whoop.com/oauth/oauth2/auth?ok=1");

    await GET(new Request("https://preview-123.vercel.app/api/whoop/authorize"));

    expect(buildWhoopAuthorizeUrlMock.mock.calls[0]![0]).toBe("https://preview-123.vercel.app/api/whoop/callback");
  });
});
