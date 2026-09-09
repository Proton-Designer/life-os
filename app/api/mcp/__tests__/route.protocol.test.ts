import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * A genuine MCP protocol round trip (PROGRAM-PLAN.md's own exit criterion
 * for L3+) driven by the real `@modelcontextprotocol/sdk` Client — the
 * initialize handshake, session-id negotiation, `tools/list`, and
 * `tools/call` all go through the SDK's real wire logic, not a hand-rolled
 * JSON-RPC body. The only thing standing in for the network is the
 * transport's `fetch` override, which calls this route's EXPORTED handler
 * in-process instead of making a real HTTP request — there is no server,
 * no port, and no real Supabase reachable from this test environment.
 *
 * Mocked, and why: `lib/supabase/service-role` (no live project here),
 * `lib/mcp/session` (real signing needs a real imported-into-Supabase
 * public key, which per R4b doesn't exist yet — this is exactly the
 * "expected to fail until then" gap the L3 brief names), and
 * `lib/mcp/tokens`'s `verifyAccessToken` (already proven in isolation in
 * tokens.test.ts). Everything BETWEEN those — `withMcpAuth`, tool
 * registration, `ctx.http.authInfo` threading, `runMcpTool`'s scope/rate-
 * limit/audit composition, the two tools' own query shapes against a fake
 * user client — runs for real.
 */

vi.mock("@/lib/mcp/tokens", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp/tokens")>("@/lib/mcp/tokens");
  return {
    ...actual,
    verifyAccessToken: vi.fn(async () => ({ userId: "user-1", tokenId: "tok-1", scopes: ["read", "write"] as const })),
  };
});
vi.mock("@/lib/mcp/active-user", () => ({ isUserActive: vi.fn(async () => true) }));

const mintSessionJwtMock = vi.fn(async () => "fake.session.jwt");
const buildUserScopedClientMock = vi.fn(() => fakeUserClient());
vi.mock("@/lib/mcp/session", () => ({
  mintSessionJwt: mintSessionJwtMock,
  buildUserScopedClient: buildUserScopedClientMock,
}));

function fakeServiceClient() {
  const auditInserts: Record<string, unknown>[] = [];
  const from = vi.fn((table: string) => {
    if (table === "mcp_audit_log") {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte"]) chain[m] = vi.fn(() => chain);
      const selectResolved = { count: 0, error: null };
      chain.then = (resolve: (v: typeof selectResolved) => void) => resolve(selectResolved);
      chain.insert = vi.fn((row: Record<string, unknown>) => {
        auditInserts.push(row);
        return { then: (r: (v: { error: null }) => void) => r({ error: null }) };
      });
      return chain;
    }
    // mcp_access_tokens — only touchLastUsed's update() hits this path here.
    const chain: Record<string, unknown> = {};
    chain.update = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.then = (r: (v: { error: null }) => void) => r({ error: null });
    return chain;
  });
  return { client: { from }, auditInserts };
}

function fakeUserClient(profile: Record<string, unknown> | null = { display_name: "Ayman", timezone: "America/Chicago" }) {
  const from = vi.fn((_table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => ({ data: profile, error: null }));
    return chain;
  });
  return { from };
}

const { createServiceRoleClient } = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient }));

describe("app/api/mcp/route — real MCP protocol round trip", () => {
  it("lists both registered tools and successfully calls get_profile through the full chain", async () => {
    const { client: serviceClient, auditInserts } = fakeServiceClient();
    createServiceRoleClient.mockReturnValue(serviceClient);

    const { GET, POST, DELETE } = await import("../route");
    const bridgeFetch = async (url: string | URL, init?: RequestInit) => {
      const req = new Request(url, init);
      if (req.method === "GET") return GET(req);
      if (req.method === "DELETE") return DELETE(req);
      return POST(req);
    };

    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
      fetch: bridgeFetch,
      requestInit: { headers: { Authorization: "Bearer lifeos_pat_a-real-live-token" } },
    });
    const client = new Client({ name: "test-client", version: "0.0.0" });

    await client.connect(transport);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_profile", "list_tasks_due_today"]);

    const result = await client.callTool({ name: "get_profile", arguments: {} });
    expect(result.isError).toBeFalsy();
    const block = (result.content as { type: string; text?: string }[])[0];
    expect(block.type).toBe("text");
    expect(JSON.parse(block.text ?? "{}")).toEqual({ display_name: "Ayman", timezone: "America/Chicago" });

    // The wrapper's own guarantee, proven at the real protocol boundary too:
    // a successful tools/call left exactly one 'ok'-outcome audit row.
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({ tool_name: "get_profile", outcome: "ok", user_id: "user-1", token_id: "tok-1" });

    await client.close();
  });
});
