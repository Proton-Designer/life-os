import { describe, expect, it, vi, beforeEach } from "vitest";

const getAuthedUser = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({ getAuthedUser: (...args: unknown[]) => getAuthedUser(...args) }));

const createClient = vi.fn(async () => "user-client-marker");
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => "service-client-marker") }));

const getOAuthClient = vi.fn();
const mintAuthorizationCode = vi.fn();
vi.mock("@/lib/mcp/oauth", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/mcp/oauth")>();
  return {
    ...actual,
    getOAuthClient: (...args: unknown[]) => getOAuthClient(...args),
    mintAuthorizationCode: (...args: unknown[]) => mintAuthorizationCode(...args),
  };
});

import { GET, POST } from "../route";

const REGISTERED_CLIENT = {
  client_id: "lifeos_client_abc",
  client_name: "Claude",
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  created_at: "2026-09-09T00:00:00Z",
};

function authorizeUrl(overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({
    client_id: "lifeos_client_abc",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    response_type: "code",
    code_challenge: "a-real-challenge-value",
    code_challenge_method: "S256",
    state: "xyz",
    ...overrides,
  });
  return `https://lifeos.example.com/api/mcp/oauth/authorize?${params.toString()}`;
}

beforeEach(() => {
  getAuthedUser.mockReset();
  getOAuthClient.mockReset();
  mintAuthorizationCode.mockReset();
  getOAuthClient.mockResolvedValue(REGISTERED_CLIENT);
});

describe("GET /api/mcp/oauth/authorize", () => {
  it("shows an error page (not a redirect) for an unknown client_id — never trust an unregistered redirect_uri", async () => {
    getOAuthClient.mockResolvedValueOnce(null);
    const response = await GET(new Request(authorizeUrl()));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("shows an error page (not a redirect) when redirect_uri isn't one of the client's registered URIs", async () => {
    const response = await GET(new Request(authorizeUrl({ redirect_uri: "https://evil.example.com/cb" })));
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).not.toContain("evil.example.com");
  });

  it("redirects with an error once redirect_uri IS validated safe, for a downstream protocol violation", async () => {
    const response = await GET(new Request(authorizeUrl({ code_challenge_method: "plain" })));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(location.searchParams.get("error")).toBe("invalid_request");
    expect(location.searchParams.get("state")).toBe("xyz");
  });

  it("shows a login-required page when there is no session, never auto-approving", async () => {
    getAuthedUser.mockResolvedValueOnce(null);
    const response = await GET(new Request(authorizeUrl()));
    const body = await response.text();
    expect(body).toContain("Sign in");
    expect(mintAuthorizationCode).not.toHaveBeenCalled();
  });

  it("shows the consent page, naming the real client and redirect host, when a session exists", async () => {
    getAuthedUser.mockResolvedValueOnce({ id: "user-1", email: "a@b.com" });
    const response = await GET(new Request(authorizeUrl()));
    const body = await response.text();
    expect(body).toContain("Claude");
    expect(body).toContain("claude.ai");
    expect(mintAuthorizationCode).not.toHaveBeenCalled();
  });
});

describe("POST /api/mcp/oauth/authorize", () => {
  function formRequest(fields: Record<string, string>, extraHeaders: Record<string, string> = {}) {
    const body = new URLSearchParams(fields);
    return new Request("https://lifeos.example.com/api/mcp/oauth/authorize", {
      method: "POST",
      // P4-13: the consent POST requires a same-origin Origin header (a real browser form submit sends one).
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://lifeos.example.com", ...extraHeaders },
      body: body.toString(),
    });
  }

  const baseFields = {
    client_id: "lifeos_client_abc",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    response_type: "code",
    code_challenge: "a-real-challenge-value",
    code_challenge_method: "S256",
    state: "xyz",
    scope: "read write",
  };

  it("a 'deny' decision redirects with access_denied and mints NO code", async () => {
    getAuthedUser.mockResolvedValueOnce({ id: "user-1", email: "a@b.com" });
    const response = await POST(formRequest({ ...baseFields, decision: "deny" }));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(mintAuthorizationCode).not.toHaveBeenCalled();
  });

  it("an 'allow' decision mints a code and redirects with it, using the user's OWN per-request client (not service-role)", async () => {
    getAuthedUser.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    mintAuthorizationCode.mockResolvedValueOnce({ ok: true, code: "lifeos_oauthcode_abc" });

    const response = await POST(formRequest({ ...baseFields, decision: "allow" }));

    expect(mintAuthorizationCode).toHaveBeenCalledWith(
      "user-client-marker",
      expect.objectContaining({ clientId: "lifeos_client_abc", userId: "user-1", scopes: ["read", "write"] })
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("code")).toBe("lifeos_oauthcode_abc");
    expect(location.searchParams.get("state")).toBe("xyz");
  });

  it("re-checks the session immediately before minting — a session that vanished between GET and POST does not get a code", async () => {
    getAuthedUser.mockResolvedValueOnce(null);
    const response = await POST(formRequest({ ...baseFields, decision: "allow" }));
    const body = await response.text();
    expect(body).toContain("Sign in");
    expect(mintAuthorizationCode).not.toHaveBeenCalled();
  });

  it("rejects a tampered redirect_uri in the form body, the same as GET would", async () => {
    getAuthedUser.mockResolvedValueOnce({ id: "user-1", email: "a@b.com" });
    const response = await POST(formRequest({ ...baseFields, redirect_uri: "https://evil.example.com/cb", decision: "allow" }));
    expect(response.status).toBe(400);
    expect(mintAuthorizationCode).not.toHaveBeenCalled();
  });

  it("rejects a missing/garbage decision value", async () => {
    getAuthedUser.mockResolvedValueOnce({ id: "user-1", email: "a@b.com" });
    const response = await POST(formRequest({ ...baseFields, decision: "maybe" }));
    expect(response.status).toBe(400);
    expect(mintAuthorizationCode).not.toHaveBeenCalled();
  });
});

describe("P4-13 authorize hardening", () => {
  function post(fields: Record<string, string>, headers: Record<string, string>) {
    return POST(
      new Request("https://lifeos.example.com/api/mcp/oauth/authorize", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
        body: new URLSearchParams(fields).toString(),
      }),
    );
  }
  const fields = {
    client_id: "lifeos_client_abc",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    response_type: "code",
    code_challenge: "a-real-challenge-value",
    code_challenge_method: "S256",
    state: "xyz",
    scope: "read write",
    decision: "allow",
  };

  it("login-required page links to /login?next=<this authorize URL> (GET)", async () => {
    getAuthedUser.mockResolvedValueOnce(null);
    const response = await GET(new Request(authorizeUrl()));
    const body = await response.text();
    const href = /href="([^"]+)"/.exec(body)![1].replace(/&amp;/g, "&");
    const login = new URL(href, "https://lifeos.example.com");
    expect(login.pathname).toBe("/login");
    const next = login.searchParams.get("next")!;
    expect(next.startsWith("/api/mcp/oauth/authorize?")).toBe(true);
    expect(new URLSearchParams(next.split("?")[1]).get("client_id")).toBe("lifeos_client_abc");
    expect(new URLSearchParams(next.split("?")[1]).get("state")).toBe("xyz");
  });

  it("login-required page after a POST links back to the GET authorize URL, without the decision", async () => {
    getAuthedUser.mockResolvedValueOnce(null);
    const response = await post(fields, { origin: "https://lifeos.example.com" });
    const href = /href="([^"]+)"/.exec(await response.text())![1].replace(/&amp;/g, "&");
    const next = new URL(href, "https://lifeos.example.com").searchParams.get("next")!;
    expect(next.startsWith("/api/mcp/oauth/authorize?")).toBe(true);
    expect(next).not.toContain("decision");
  });

  it("an omitted scope defaults to READ only, and the consent page says so", async () => {
    getAuthedUser.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    const url = new URL(authorizeUrl());
    url.searchParams.delete("scope");
    const page = await (await GET(new Request(url.toString()))).text();
    expect(page).toContain('name="scope" value="read"');

    mintAuthorizationCode.mockResolvedValueOnce({ ok: true, code: "c" });
    const { scope: _omit, ...noScope } = fields;
    void _omit;
    await post(noScope, { origin: "https://lifeos.example.com" });
    expect(mintAuthorizationCode).toHaveBeenCalledWith("user-client-marker", expect.objectContaining({ scopes: ["read"] }));
  });

  it("an explicit 'read write' scope is still honoured", async () => {
    getAuthedUser.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    mintAuthorizationCode.mockResolvedValueOnce({ ok: true, code: "c" });
    await post(fields, { origin: "https://lifeos.example.com" });
    expect(mintAuthorizationCode).toHaveBeenCalledWith("user-client-marker", expect.objectContaining({ scopes: ["read", "write"] }));
  });

  it("a resource that is not this server's /api/mcp is refused with invalid_target (redirect)", async () => {
    getAuthedUser.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    for (const bad of ["https://evil.example.com/api/mcp", "https://lifeos.example.com/api/other", "https://lifeos.example.com/api/mcp?x=1", "not a url"]) {
      const response = await GET(new Request(authorizeUrl({ resource: bad })));
      expect(response.status, bad).toBe(302);
      expect(new URL(response.headers.get("location")!).searchParams.get("error"), bad).toBe("invalid_target");
    }
    expect(mintAuthorizationCode).not.toHaveBeenCalled();
  });

  it("the correct resource (with or without a trailing slash) is accepted", async () => {
    getAuthedUser.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    for (const good of ["https://lifeos.example.com/api/mcp", "https://lifeos.example.com/api/mcp/"]) {
      const response = await GET(new Request(authorizeUrl({ resource: good })));
      expect(response.status, good).toBe(200);
    }
  });

  it("the consent POST is refused (403, no code) without an Origin/Referer, or from another origin", async () => {
    getAuthedUser.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    const cases: Record<string, string>[] = [{}, { origin: "https://evil.example.com" }, { origin: "null" }, { referer: "https://evil.example.com/page" }];
    for (const headers of cases) {
      const response = await post(fields, headers);
      expect(response.status, JSON.stringify(headers)).toBe(403);
    }
    expect(mintAuthorizationCode).not.toHaveBeenCalled();
  });

  it("a same-origin Referer is accepted when Origin is absent", async () => {
    getAuthedUser.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    mintAuthorizationCode.mockResolvedValueOnce({ ok: true, code: "c" });
    const response = await post(fields, { referer: "https://lifeos.example.com/api/mcp/oauth/authorize?client_id=x" });
    expect(response.status).toBe(302);
    expect(mintAuthorizationCode).toHaveBeenCalled();
  });
});
