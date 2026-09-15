import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(() => "service-client-marker"),
}));

const registerOAuthClient = vi.fn();
vi.mock("@/lib/mcp/oauth", async (importActual) => ({
  // Real clientIpFromHeaders / hashRegistrationIp (pure), mocked registration.
  ...(await importActual<typeof import("@/lib/mcp/oauth")>()),
  registerOAuthClient: (...args: unknown[]) => registerOAuthClient(...args),
}));

import { POST } from "../route";

function jsonRequest(body: unknown) {
  return new Request("https://lifeos.example.com/api/mcp/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mcp/oauth/register", () => {
  it("rejects a non-JSON body without ever calling registerOAuthClient", async () => {
    const request = new Request("https://lifeos.example.com/api/mcp/oauth/register", {
      method: "POST",
      body: "not json at all",
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(registerOAuthClient).not.toHaveBeenCalled();
  });

  it("rejects a JSON array/primitive body (not an object)", async () => {
    const response = await POST(jsonRequest([1, 2, 3]));
    expect(response.status).toBe(400);
    expect(registerOAuthClient).not.toHaveBeenCalled();
  });

  it("passes the body through to registerOAuthClient with the service-role client", async () => {
    registerOAuthClient.mockResolvedValueOnce({
      ok: true,
      client: { client_id: "lifeos_client_abc", client_id_issued_at: 1, client_name: "Claude", redirect_uris: ["https://claude.ai/cb"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
    });

    const response = await POST(jsonRequest({ redirect_uris: ["https://claude.ai/cb"], client_name: "Claude" }));

    expect(registerOAuthClient).toHaveBeenCalledWith("service-client-marker", { redirect_uris: ["https://claude.ai/cb"], client_name: "Claude" }, { ipHash: null });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.client_id).toBe("lifeos_client_abc");
  });

  it("surfaces a rejection's own status/error/message, never a generic 500", async () => {
    registerOAuthClient.mockResolvedValueOnce({ ok: false, status: 429, error: "temporarily_unavailable", message: "Registration limit reached." });

    const response = await POST(jsonRequest({ redirect_uris: ["https://claude.ai/cb"] }));

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe("temporarily_unavailable");
  });

  it("P4-13: passes the keyed hash of the caller's IP (never the raw IP) for the per-IP limit", async () => {
    registerOAuthClient.mockResolvedValueOnce({ ok: false, status: 429, error: "temporarily_unavailable", message: "Too many" });
    const req = new Request("https://lifeos.example.com/api/mcp/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
      body: JSON.stringify({ redirect_uris: ["https://claude.ai/cb"] }),
    });
    const response = await POST(req);
    expect(response.status).toBe(429);
    const opts = registerOAuthClient.mock.calls.at(-1)![2] as { ipHash: string };
    expect(opts.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(opts.ipHash).not.toContain("203.0.113.9");
  });
});
