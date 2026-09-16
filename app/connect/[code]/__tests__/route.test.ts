import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => "service-client-marker") }));

const exchangeConnectCodeCore = vi.fn();
vi.mock("@/lib/mcp/connect-codes", () => ({
  exchangeConnectCodeCore: (...args: unknown[]) => exchangeConnectCodeCore(...args),
}));

const checkAgentConnectLimit = vi.fn();
vi.mock("@/lib/mcp/agent-connect-rate-limit", () => ({
  checkAgentConnectLimit: (...args: unknown[]) => checkAgentConnectLimit(...args),
}));

import { GET, POST } from "../route";

function params(code: string) {
  return { params: Promise.resolve({ code }) };
}

const SUCCESS_RESULT = {
  ok: true,
  token: "raw-minted-token",
  status: { id: "token-1", label: "My agent", scopes: ["read"], expiresAt: "2026-10-16T00:00:00.000Z", clientKind: "agent" },
};

beforeEach(() => {
  exchangeConnectCodeCore.mockReset();
  checkAgentConnectLimit.mockReset();
  checkAgentConnectLimit.mockResolvedValue({ limited: false });
});

describe("GET /connect/[code]", () => {
  it("checks the per-IP rate limit before ever touching the code", async () => {
    checkAgentConnectLimit.mockResolvedValueOnce({ limited: false });
    exchangeConnectCodeCore.mockResolvedValueOnce({ ok: false });

    await GET(new Request("https://lifeos.example.com/connect/abc"), params("abc"));

    expect(checkAgentConnectLimit).toHaveBeenCalled();
  });

  it("429s when the network is rate-limited, without ever calling the exchange (so it can't leak a per-code signal)", async () => {
    checkAgentConnectLimit.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 30 });

    const response = await GET(new Request("https://lifeos.example.com/connect/abc"), params("abc"));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(exchangeConnectCodeCore).not.toHaveBeenCalled();
  });

  it("410s markdown for an invalid code (unknown/expired/used all collapse into exchangeConnectCodeCore's single {ok:false})", async () => {
    exchangeConnectCodeCore.mockResolvedValueOnce({ ok: false });

    const response = await GET(new Request("https://lifeos.example.com/connect/bad-code"), params("bad-code"));

    expect(response.status).toBe(410);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    const body = await response.text();
    expect(body).not.toContain("undefined");
  });

  it("on a fresh code: mints via the shared core, renders the raw token in markdown, and sends noindex", async () => {
    exchangeConnectCodeCore.mockResolvedValueOnce(SUCCESS_RESULT);

    const response = await GET(new Request("https://lifeos.example.com/connect/good-code"), params("good-code"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    const body = await response.text();
    expect(body).toContain("raw-minted-token");
    expect(body).toContain("read");
    expect(exchangeConnectCodeCore).toHaveBeenCalledWith("service-client-marker", "good-code");
  });
});

describe("POST /connect/[code]", () => {
  it("429s JSON when rate-limited, without calling the exchange", async () => {
    checkAgentConnectLimit.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 12 });

    const response = await POST(new Request("https://lifeos.example.com/connect/abc", { method: "POST" }), params("abc"));

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe("rate_limited");
    expect(exchangeConnectCodeCore).not.toHaveBeenCalled();
  });

  it("410s the SAME JSON shape for unknown/expired/used codes (no enumeration signal)", async () => {
    exchangeConnectCodeCore.mockResolvedValueOnce({ ok: false });

    const response = await POST(new Request("https://lifeos.example.com/connect/bad-code", { method: "POST" }), params("bad-code"));

    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body.error).toBe("invalid_or_expired");
  });

  it("on a fresh code: returns the token as structured JSON, never wrapped in markdown", async () => {
    exchangeConnectCodeCore.mockResolvedValueOnce(SUCCESS_RESULT);

    const response = await POST(new Request("https://lifeos.example.com/connect/good-code", { method: "POST" }), params("good-code"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.token).toBe("raw-minted-token");
    expect(body.scopes).toEqual(["read"]);
    expect(body.mcp_url).toBe("https://lifeos.example.com/api/mcp");
    expect(body.rest_base_url).toBe("https://lifeos.example.com/api/v1");
  });

  it("a GET hit and a POST hit both call the SAME exchange core -- whichever fires first is the real exchange", async () => {
    exchangeConnectCodeCore.mockResolvedValueOnce(SUCCESS_RESULT);
    await GET(new Request("https://lifeos.example.com/connect/x"), params("x"));
    expect(exchangeConnectCodeCore).toHaveBeenCalledTimes(1);

    exchangeConnectCodeCore.mockResolvedValueOnce({ ok: false });
    await POST(new Request("https://lifeos.example.com/connect/x", { method: "POST" }), params("x"));
    expect(exchangeConnectCodeCore).toHaveBeenCalledTimes(2);
  });
});
