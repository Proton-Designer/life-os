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
 * limit/audit composition, `read`'s registry dispatch against a fake user
 * client — runs for real.
 */

vi.mock("@/lib/mcp/tokens", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp/tokens")>("@/lib/mcp/tokens");
  return {
    ...actual,
    // The bearer token itself picks the scope set, so one mock can drive
    // both the full-access and read-only-token cases in the same file
    // without per-test module-mock gymnastics.
    verifyAccessToken: vi.fn(async (_client: unknown, rawToken: string) => ({
      userId: "user-1",
      tokenId: rawToken.includes("readonly") ? "tok-readonly" : "tok-1",
      scopes: rawToken.includes("readonly") ? (["read"] as const) : (["read", "write"] as const),
    })),
  };
});
vi.mock("@/lib/mcp/active-user", () => ({ isUserActive: vi.fn(async () => true) }));

const PRAYER_ROWS = [
  { id: "p1", date: "2026-09-08", prayer_name: "fajr", status: "on_time", logged_at: "2026-09-08T11:00:00Z", user_id: "user-1" },
  { id: "p2", date: "2026-09-08", prayer_name: "dhuhr", status: "qada", logged_at: "2026-09-08T18:00:00Z", user_id: "user-1" },
];

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

/**
 * Stands in for the RLS-scoped client `read`/`write`'s dispatch queries
 * touch — `prayers`/`profiles` are what L3/L6 wire (lib/mcp/registry.ts,
 * lib/mcp/write-registry.ts). `upsert(...).select(...).single()` is the
 * shape `markPrayerCore` (lib/deen/actions-core.ts) needs for its `write
 * -> {id, updated_at}` contract.
 */
function fakeUserClient(profileTimezone = "America/Chicago") {
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "is", "in"]) chain[m] = vi.fn(() => chain);
    // P4-03's account map awaits the user_domains query directly (no terminal call).
    chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null });
    chain.range = vi.fn(async () => ({ data: PRAYER_ROWS, error: null, count: PRAYER_ROWS.length }));
    chain.maybeSingle = vi.fn(async () =>
      table === "profiles" ? { data: { timezone: profileTimezone }, error: null } : { data: PRAYER_ROWS[0], error: null },
    );
    chain.upsert = vi.fn(() => chain);
    chain.single = vi.fn(async () => ({ data: { id: "p-new", logged_at: "2026-09-08T20:00:00.000Z" }, error: null }));
    return chain;
  });
  return { from };
}

const { createServiceRoleClient } = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient }));

describe("app/api/mcp/route — real MCP protocol round trip", () => {
  it("lists the two registered tools, discovers the deen/prayer entity, and reads real data through the full chain", async () => {
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

    // P4-03: static initialize instructions point the agent at the account map.
    expect(client.getInstructions()).toMatch(/list_capabilities\(\) first/);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["list_capabilities", "read", "scheduler_manage", "widget_manage", "write"]);

    // Discovery first — the actual intended usage pattern (memo §5: "call
    // whenever unsure"), and it should cost nothing against a real DB.
    const caps = await client.callTool({ name: "list_capabilities", arguments: { domain: "deen" } });
    expect(caps.isError).toBeFalsy();
    const capsBlock = (caps.content as { type: string; text?: string }[])[0];
    const capsPayload = JSON.parse(capsBlock.text ?? "{}");
    expect(capsPayload.entities.map((e: { entity: string }) => e.entity)).toContain("prayer");

    // P4-03: the no-argument call is this account's map, built through the
    // same user-scoped client (profile timezone America/Chicago here).
    const map = await client.callTool({ name: "list_capabilities", arguments: {} });
    expect(map.isError).toBeFalsy();
    const mapPayload = JSON.parse(((map.content as { type: string; text?: string }[])[0].text) ?? "{}");
    expect(mapPayload.today.timezone).toBe("America/Chicago");
    expect(mapPayload.today.local_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mapPayload.domain_fields).toEqual(["one_line", "active_for_account", "read", "write", "views"]);
    expect(mapPayload.domains.deen[2]).toContain("prayer");

    // Then the actual read, using exactly the entity discovery just named.
    const result = await client.callTool({ name: "read", arguments: { domain: "deen", entity: "prayer" } });
    expect(result.isError).toBeFalsy();
    const block = (result.content as { type: string; text?: string }[])[0];
    const payload = JSON.parse(block.text ?? "{}");
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]).toMatchObject({ id: "p1", updated_at: "2026-09-08T11:00:00Z", date: "2026-09-08", prayer_name: "fajr", status: "on_time" });

    // Now the actual WRITE — L6's whole point — through the exact same chain.
    const writeResult = await client.callTool({
      name: "write",
      arguments: { domain: "deen", entity: "prayer", action: "log", patch: { date: "2026-09-08", prayer_name: "fajr", status: "on_time" } },
    });
    expect(writeResult.isError).toBeFalsy();
    const writeBlock = (writeResult.content as { type: string; text?: string }[])[0];
    const writePayload = JSON.parse(writeBlock.text ?? "{}");
    expect(writePayload).toMatchObject({ id: "p-new", date: "2026-09-08", status: "on_time" });

    // The wrapper's own guarantee, proven at the real protocol boundary:
    // three tool calls left exactly three audit rows, each carrying the
    // RESOLVED operation (migration 131), not just the generic tool name.
    expect(auditInserts).toHaveLength(4);
    expect(auditInserts[0]).toMatchObject({ tool_name: "list_capabilities", operation: "discovery.deen.list_capabilities", outcome: "ok" });
    expect(auditInserts.splice(1, 1)[0]).toMatchObject({ tool_name: "list_capabilities", operation: "discovery.list_capabilities", outcome: "ok" });
    expect(auditInserts[1]).toMatchObject({ tool_name: "read", operation: "deen.prayer.read", outcome: "ok", user_id: "user-1", token_id: "tok-1" });
    expect(auditInserts[2]).toMatchObject({ tool_name: "write", operation: "deen.prayer.log", outcome: "ok", user_id: "user-1", token_id: "tok-1" });

    await client.close();
  });

  it("DENIES a write from a read-only token, and audits it as denied — the scope check actually biting, not decorative", async () => {
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
      // "readonly" in the token string is what this file's verifyAccessToken
      // mock keys off of to return scopes: ["read"] only.
      requestInit: { headers: { Authorization: "Bearer lifeos_pat_readonly-token" } },
    });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(transport);

    const result = await client.callTool({
      name: "write",
      arguments: { domain: "deen", entity: "prayer", action: "log", patch: { date: "2026-09-08", prayer_name: "fajr", status: "on_time" } },
    });

    expect(result.isError).toBe(true);
    const block = (result.content as { type: string; text?: string }[])[0];
    expect(block.text).toMatch(/write.*permission/i);

    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({
      tool_name: "write",
      operation: "deen.prayer.log",
      outcome: "denied",
      token_id: "tok-readonly",
    });

    await client.close();
  });
});
