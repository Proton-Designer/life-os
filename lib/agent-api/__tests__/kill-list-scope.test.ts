import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthInfoLike } from "@/lib/mcp/auth-info";
import { KILL_LIST_SCOPE_OPERATIONS, tokenAllowsOperation, validateScopes, MCP_SCOPES } from "@/lib/mcp/tokens";

/**
 * The `kill_list` token scope (the MyHomeBase console, 2026-11-02). One external system mirrors today's business Kill List, so its token may do ONLY: GET /me, read
 * business.kill_list_item, and set / set_completed / clear on it. Every other operation is refused at the dispatcher (executeOperation), not merely hidden. `toggle` is
 * refused on purpose (not idempotent). Same shape as jobs-scope.test.ts; the CONTROLs at the bottom prove these assertions can fail.
 */

vi.mock("@/lib/mcp/session", () => ({ mintSessionJwt: async () => "jwt", buildUserScopedClient: () => ({ __fake: "client" }) }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/mcp/webhook-dispatch", () => ({ enqueueWriteOkWebhookDeliveries: async () => {} }));
vi.mock("@/lib/ai/gateway", () => ({ gatewayChat: vi.fn() }));

function serviceClient() {
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "update", "is"]) chain[m] = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
    chain.insert = vi.fn(() => ({ then: (resolve: (v: unknown) => void) => resolve({ error: null }) }));
    return chain;
  });
  const rpc = vi.fn(async () => ({ data: { allowed: true }, error: null }));
  return { from, rpc } as unknown as SupabaseClient;
}

const auth = (scopes: string[]): AuthInfoLike => ({ scopes, extra: { userId: "user-1", tokenId: "tok-1" } });
const KILL = auth(["kill_list"]);
const OK = { result: { content: [{ type: "text" as const, text: "{}" }] }, summary: "ok" };
const D = "2026-11-02";

async function specFor(tool: string, args: Record<string, unknown>) {
  const { buildOperationSpec } = await import("../operations");
  const spec = buildOperationSpec(tool as never, args as never, { tokenId: "tok-1" });
  const run = vi.fn(async () => OK);
  return { spec: { ...spec, run }, run };
}

beforeEach(() => vi.clearAllMocks());

const ALLOWED: [string, string, Record<string, unknown>][] = [
  ["read the kill list", "read", { domain: "business", entity: "kill_list_item", filter: { date: D } }],
  ["set a slot's text", "write", { domain: "business", entity: "kill_list_item", action: "set", patch: { date: D, position: 0, text: "x" } }],
  ["set a slot's completion", "write", { domain: "business", entity: "kill_list_item", action: "set_completed", patch: { date: D, position: 0, completed: true } }],
  ["clear a slot", "write", { domain: "business", entity: "kill_list_item", action: "clear", patch: { date: D, position: 0 } }],
];
const REFUSED: [string, string, Record<string, unknown>][] = [
  ["toggle (not idempotent)", "write", { domain: "business", entity: "kill_list_item", action: "toggle", id: "i" }],
  ["the business weekly goal", "write", { domain: "business", entity: "weekly_goal", action: "save", patch: { week_start_date: D, headline: "h", milestones: [] } }],
  ["read the weekly goal", "read", { domain: "business", entity: "weekly_goal" }],
  ["read tasks", "read", { domain: "work", entity: "task" }],
  ["read prayers", "read", { domain: "deen", entity: "prayer" }],
  ["read the profile", "read", { domain: "settings", entity: "profile" }],
  ["read api keys", "read", { domain: "settings", entity: "api_key" }],
  ["write a task", "write", { domain: "work", entity: "task", action: "add", patch: { title: "x" } }],
  ["write the morning brief", "write", { domain: "day", entity: "morning_brief", action: "write", patch: { text: "x" } }],
  ["claim an agent job", "write", { domain: "agent", entity: "job", action: "claim", patch: {} }],
  ["list_capabilities", "list_capabilities", {}],
  ["widget_manage", "widget_manage", { action: "list" }],
  ["scheduler_manage create", "scheduler_manage", { action: "create", patch: {} }],
];

describe("a kill_list-only token", () => {
  it.each(ALLOWED)("may %s", async (_n, tool, args) => {
    const { executeOperation } = await import("../execute");
    const { spec, run } = await specFor(tool, args);
    const out = await executeOperation(serviceClient(), KILL, spec, "rest");
    expect(out.ok).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(REFUSED)("is refused at the dispatcher: %s", async (_n, tool, args) => {
    const { executeOperation } = await import("../execute");
    const { spec, run } = await specFor(tool, args);
    const out = await executeOperation(serviceClient(), KILL, spec, "rest");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("insufficient_scope");
    expect(run).not.toHaveBeenCalled();
  });

  it("is refused the same way through the generic /actions tool arguments and the MCP transport", async () => {
    const { executeOperation } = await import("../execute");
    for (const transport of ["mcp", "rest"] as const) {
      const { spec, run } = await specFor("write", { domain: "work", entity: "task", action: "add", patch: { title: "x" } });
      const out = await executeOperation(serviceClient(), KILL, spec, transport);
      expect(out.ok).toBe(false);
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("may call GET /me (the console verifies its scopes with it) and nothing else of discovery", () => {
    expect(tokenAllowsOperation(["kill_list"], "read", "discovery.me")).toBe(true);
    expect(tokenAllowsOperation(["kill_list"], "read", "discovery.capabilities")).toBe(false);
  });
});

describe("the scope table", () => {
  it("is exactly the console's five operations", () => {
    expect([...KILL_LIST_SCOPE_OPERATIONS].sort()).toEqual([
      "business.kill_list_item.clear", "business.kill_list_item.read", "business.kill_list_item.set", "business.kill_list_item.set_completed", "discovery.me",
    ]);
  });
  it("validateScopes accepts kill_list alone and kill_list is a known scope", () => {
    expect(validateScopes(["kill_list"])).toBeNull();
    expect(MCP_SCOPES).toContain("kill_list");
  });
  it("kill_list never widens a token that also holds read: read still reads everything, write still writes everything", () => {
    expect(tokenAllowsOperation(["read", "kill_list"], "read", "work.task.read")).toBe(true);
    expect(tokenAllowsOperation(["kill_list"], "read", "work.task.read")).toBe(false);
    expect(tokenAllowsOperation(["kill_list"], "write", "work.task.add")).toBe(false);
  });
  it("kill_list does not grant the jobs operations, and jobs does not grant the kill list", () => {
    expect(tokenAllowsOperation(["kill_list"], "write", "agent.job.claim")).toBe(false);
    expect(tokenAllowsOperation(["jobs"], "write", "business.kill_list_item.set")).toBe(false);
  });
});

describe("CONTROLs: these assertions can fail", () => {
  it("a read+write token passes every refused operation above (so the refusals are the scope's doing, not the fixtures')", async () => {
    const { executeOperation } = await import("../execute");
    const broad = auth(["read", "write"]);
    for (const [, tool, args] of REFUSED.filter(([n]) => !/scheduler|widget|capabilities/.test(n))) {
      const { spec, run } = await specFor(tool, args);
      const out = await executeOperation(serviceClient(), broad, spec, "rest");
      expect(out.ok, JSON.stringify(args)).toBe(true);
      expect(run).toHaveBeenCalledTimes(1);
    }
  });
  it("with the scope removed the kill list operations are refused too", async () => {
    const { executeOperation } = await import("../execute");
    const { spec, run } = await specFor("write", { domain: "business", entity: "kill_list_item", action: "set", patch: { date: D, position: 0, text: "x" } });
    const out = await executeOperation(serviceClient(), auth(["jobs"]), spec, "rest");
    expect(out.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
