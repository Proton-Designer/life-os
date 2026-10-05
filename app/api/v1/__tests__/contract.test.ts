import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { RATE_LIMIT_MAX_CALLS } from "@/lib/mcp/rate-limit";
import { REGISTRY } from "@/lib/mcp/registry";
import { WRITE_REGISTRY } from "@/lib/mcp/write-registry";
import { AGENT_TOOL_NAMES } from "@/lib/agent-api/tool-names";
import { fakeServiceClient, fakeUserClient } from "./fake-db";

/**
 * P4-17 contract: for the same fake database, the REST adapter returns
 * exactly what the MCP server returns. That covers every REGISTRY entity
 * (list and by-id), every WRITE_REGISTRY action, list_capabilities (map plus
 * every domain) and both manager lists. MCP runs through the real
 * @modelcontextprotocol/sdk Client against app/api/mcp/route.ts. REST runs
 * through app/api/v1's exported handlers.
 * - MCP success  → REST 200 and body deep-equals structuredContent
 *   (or {text} when the tool gave none).
 * - MCP isError  → REST non-2xx problem+json whose detail is MCP's text.
 * Both outcome kinds are counted and must each be non-zero, so the test
 * can't pass by comparing only errors or only successes.
 *
 * Plus the shared budget: MCP and REST count the same per-token audit rows.
 */

// P4-22: after() needs a real Next.js request scope this in-process
// harness doesn't provide -- without this mock it throws synchronously on
// any successful write (same fix as app/api/mcp/__tests__/route.protocol.test.ts).
vi.mock("next/server", () => ({ after: (task: () => unknown) => void task() }));

vi.mock("@/lib/mcp/tokens", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp/tokens")>("@/lib/mcp/tokens");
  return {
    ...actual,
    verifyAccessToken: vi.fn(async (_c: unknown, raw: string) => {
      const tokenId = raw.replace(/^lifeos_pat_/, "");
      return raw.startsWith("lifeos_pat_") ? { userId: "user-1", tokenId, scopes: ["read", "write"] as const } : null;
    }),
  };
});
vi.mock("@/lib/mcp/active-user", () => ({ isUserActive: vi.fn(async () => true) }));
vi.mock("@/lib/mcp/session", () => ({
  mintSessionJwt: vi.fn(async () => "fake.jwt"),
  buildUserScopedClient: vi.fn(() => fakeUserClient({ rowCount: 3 })),
}));
const { createServiceRoleClient } = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient }));

let service = fakeServiceClient();

beforeAll(() => {
  // Handlers stamp `now` into results; freeze the clock (Date only, so the SDK's timers still run).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-15T14:30:00.000Z"));
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  service = fakeServiceClient({ uncountedTokens: ["contract"] });
  createServiceRoleClient.mockImplementation(() => service.client);
});

async function connectMcp(token: string) {
  const { GET, POST, DELETE } = await import("../../mcp/route");
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
    fetch: async (url: string | URL, init?: RequestInit) => {
      const req = new Request(url, init);
      return req.method === "GET" ? GET(req) : req.method === "DELETE" ? DELETE(req) : POST(req);
    },
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "contract", version: "0" });
  await client.connect(transport);
  return client;
}

async function rest(token: string, method: "GET" | "POST", pathAndQuery: string, body?: unknown) {
  const mod = pathAndQuery === "/actions" ? await import("../actions/route") : await import("../[...path]/route");
  const req = new Request(`http://localhost/api/v1${pathAndQuery}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return method === "GET" ? mod.GET(req) : mod.POST(req);
}

type McpResult = { isError?: boolean; structuredContent?: unknown; content?: unknown };

const tally = { ok: 0, error: 0 };

async function expectSame(label: string, mcp: McpResult, res: Response) {
  const text = ((mcp.content as { type: string; text?: string }[] | undefined) ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  const body = await res.json();
  if (mcp.isError) {
    tally.error++;
    expect(res.status, `${label}: MCP errored ("${text}") but REST returned ${res.status}`).toBeGreaterThanOrEqual(400);
    expect(body.detail, label).toBe(text);
  } else {
    tally.ok++;
    expect(res.status, `${label}: MCP ok but REST ${res.status} ${JSON.stringify(body)}`).toBe(200);
    expect(body, label).toEqual(mcp.structuredContent ?? { text });
  }
}

describe("contract: REST payload === MCP structuredContent for the same fake DB", () => {
  it("MCP registers exactly the tools REST dispatches", async () => {
    const client = await connectMcp("lifeos_pat_contract");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
    await client.close();
  });

  it("every registry entity: list read and by-id read", async () => {
    const client = await connectMcp("lifeos_pat_contract");
    let n = 0;
    for (const [domain, def] of Object.entries(REGISTRY)) {
      for (const entity of Object.keys(def.entities)) {
        const list = await client.callTool({ name: "read", arguments: { domain, entity, detail: "full" } });
        await expectSame(`read ${domain}.${entity}`, list as McpResult, await rest("lifeos_pat_contract", "GET", `/${domain}/${entity}?detail=full`));
        const byId = await client.callTool({ name: "read", arguments: { domain, entity, id: "row-1" } });
        await expectSame(`read ${domain}.${entity}/row-1`, byId as McpResult, await rest("lifeos_pat_contract", "GET", `/${domain}/${entity}/row-1`));
        n++;
      }
    }
    expect(n).toBeGreaterThan(20);
    await client.close();
  });

  it("every write-registry action (empty patch, and with an id)", async () => {
    const client = await connectMcp("lifeos_pat_contract");
    let n = 0;
    for (const [domain, def] of Object.entries(WRITE_REGISTRY)) {
      for (const [entity, entityDef] of Object.entries(def.entities)) {
        for (const action of Object.keys(entityDef.actions)) {
          const mcp = await client.callTool({ name: "write", arguments: { domain, entity, action, id: "row-1", patch: {} } });
          await expectSame(`write ${domain}.${entity}.${action}`, mcp as McpResult, await rest("lifeos_pat_contract", "POST", `/${domain}/${entity}/${action}`, { id: "row-1", patch: {} }));
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(20);
    await client.close();
  });

  it("list_capabilities (account map + every domain), widget and schedule lists, and POST /actions", async () => {
    const client = await connectMcp("lifeos_pat_contract");
    await expectSame("capabilities", (await client.callTool({ name: "list_capabilities", arguments: {} })) as McpResult, await rest("lifeos_pat_contract", "GET", "/capabilities"));
    for (const domain of Object.keys(REGISTRY)) {
      await expectSame(`capabilities ${domain}`, (await client.callTool({ name: "list_capabilities", arguments: { domain } })) as McpResult, await rest("lifeos_pat_contract", "GET", `/capabilities?domain=${domain}`));
    }
    await expectSame("widgets", (await client.callTool({ name: "widget_manage", arguments: { action: "list" } })) as McpResult, await rest("lifeos_pat_contract", "GET", "/manage/widgets"));
    await expectSame("schedules", (await client.callTool({ name: "scheduler_manage", arguments: { action: "list" } })) as McpResult, await rest("lifeos_pat_contract", "GET", "/manage/schedules"));
    await expectSame(
      "actions read",
      (await client.callTool({ name: "read", arguments: { domain: "deen", entity: "prayer", limit: 2 } })) as McpResult,
      await rest("lifeos_pat_contract", "POST", "/actions", { tool: "read", args: { domain: "deen", entity: "prayer", limit: 2 } }),
    );
    // Every comparison above left one audit row per transport, with the same operations in the same order.
    const byTransport = (t: string) => service.auditInserts.filter((r) => r.transport === t).map((r) => [r.operation, r.outcome]);
    expect(byTransport("rest").length).toBeGreaterThan(10);
    expect(byTransport("rest")).toEqual(byTransport("mcp"));
    await client.close();
  });

  it("both outcome kinds were actually compared (the check examined something)", () => {
    expect(tally.ok).toBeGreaterThan(20);
    expect(tally.error).toBeGreaterThan(0);
    console.log(`[contract] compared ${tally.ok} successes and ${tally.error} errors`);
  });

});

describe("shared rate limit: one per-token budget across MCP and REST", () => {
  it("(limit - 2) prior calls, then the last two succeed (one MCP, one REST), and the next is refused on BOTH transports", async () => {
    service = fakeServiceClient({ preloadCounts: { shared: RATE_LIMIT_MAX_CALLS - 2, other: 0 } });
    createServiceRoleClient.mockImplementation(() => service.client);
    const client = await connectMcp("lifeos_pat_shared");

    const mcp29 = (await client.callTool({ name: "read", arguments: { domain: "deen", entity: "prayer" } })) as McpResult;
    expect(mcp29.isError).toBeFalsy();
    expect((await rest("lifeos_pat_shared", "GET", "/deen/prayer")).status).toBe(200);

    const rest31 = await rest("lifeos_pat_shared", "GET", "/deen/prayer");
    expect(rest31.status).toBe(429);
    expect(rest31.headers.get("retry-after")).toBe("60");
    const mcp32 = (await client.callTool({ name: "read", arguments: { domain: "deen", entity: "prayer" } })) as McpResult;
    expect(mcp32.isError).toBe(true);
    expect(JSON.stringify(mcp32.content)).toMatch(/Rate limit exceeded/);

    // A different token's budget is untouched.
    expect((await rest("lifeos_pat_other", "GET", "/deen/prayer")).status).toBe(200);

    expect(service.auditInserts.filter((r) => r.token_id === "shared").map((r) => [r.transport, r.outcome])).toEqual([
      ["mcp", "ok"],
      ["rest", "ok"],
      ["rest", "denied"],
      ["mcp", "denied"],
    ]);
    await client.close();
  });
});
