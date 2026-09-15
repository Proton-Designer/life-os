import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthInfoLike } from "@/lib/mcp/auth-info";

/**
 * P4-02 — the transport-neutral operation core. Every failure mode that
 * runMcpTool used to fold into MCP text must come back as a typed
 * `{ok:false, code, status, message}` so a status-code transport (REST, T4)
 * can use it; the success path must hand back the tool's own result object
 * untouched so the MCP adapter stays byte-identical.
 *
 * Red first: written before lib/agent-api/execute.ts existed (the import
 * below failed to resolve).
 */

const mintSessionJwtMock = vi.fn(async (_userId: string) => "fake.jwt.token");
const buildUserScopedClientMock = vi.fn((_jwt: string) => ({ __fake: "user-scoped-client" }));
vi.mock("@/lib/mcp/session", () => ({
  mintSessionJwt: mintSessionJwtMock,
  buildUserScopedClient: buildUserScopedClientMock,
}));

function makeServiceClient(opts: { rateLimited?: boolean; auditInsertError?: unknown } = {}) {
  const inserts: Record<string, unknown>[] = [];
  const events: string[] = [];
  // P4-14: the limiter is one RPC (mcp_rate_limit_consume). Record what it was asked.
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return opts.rateLimited
      ? { data: { allowed: false, limited_key: `tok:${String((args.p_keys as string[])[0]).split(":")[1]}`, retry_after_seconds: 23 }, error: null }
      : { data: { allowed: true }, error: null };
  });
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "update", "is"]) chain[m] = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      inserts.push(row);
      events.push(`audit:${String(row.outcome)}`);
      return { then: (resolve: (v: unknown) => void) => resolve({ error: opts.auditInsertError ?? null }) };
    });
    return chain;
  });
  return { client: { from, rpc } as unknown as SupabaseClient, inserts, events, rpcCalls };
}

const GOOD_AUTH: AuthInfoLike = { scopes: ["read", "write"], extra: { userId: "user-1", tokenId: "tok-1" } };
const READ_ONLY_AUTH: AuthInfoLike = { scopes: ["read"], extra: { userId: "user-1", tokenId: "tok-1" } };

const TOOL_RESULT = { content: [{ type: "text" as const, text: '{"items":[]}' }], structuredContent: { items: [] } };

function op(overrides: Partial<import("../execute").OperationSpec> = {}): import("../execute").OperationSpec {
  return {
    toolName: "read",
    operation: "deen.prayer.read",
    requiredScope: "read",
    args: { domain: "deen", entity: "prayer" },
    run: vi.fn(async () => ({ result: TOOL_RESULT, summary: "returned 0 prayer(s)" })),
    ...overrides,
  };
}

beforeEach(() => {
  mintSessionJwtMock.mockClear();
  buildUserScopedClientMock.mockClear();
});

describe("executeOperation — success", () => {
  it("returns ok with the tool's own result object, its data and text, and audits ok BEFORE returning", async () => {
    const { client, inserts, events } = makeServiceClient();
    const { executeOperation } = await import("../execute");
    const spec = op();

    const outcome = await executeOperation(client, GOOD_AUTH, spec, "mcp");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.toolResult).toBe(TOOL_RESULT); // identity, not a rebuilt copy
    expect(outcome.data).toEqual({ items: [] });
    expect(outcome.text).toBe('{"items":[]}');
    expect(outcome.summary).toBe("returned 0 prayer(s)");
    expect(spec.run).toHaveBeenCalledWith({ __fake: "user-scoped-client" }, "user-1");
    expect(events).toEqual(["audit:ok"]);
    expect(inserts[0]).toEqual(expect.objectContaining({ user_id: "user-1", token_id: "tok-1", tool_name: "read", operation: "deen.prayer.read", outcome: "ok" }));
  });

  it("data is null when the tool returned no structuredContent", async () => {
    const { client } = makeServiceClient();
    const { executeOperation } = await import("../execute");
    const outcome = await executeOperation(client, GOOD_AUTH, op({ run: async () => ({ result: { content: [{ type: "text", text: "ok" }] }, summary: "s" }) }), "rest");
    expect(outcome).toEqual(expect.objectContaining({ ok: true, data: null, text: "ok" }));
  });
});

describe("executeOperation — typed failures", () => {
  it("unauthenticated → 401, no audit row, tool never runs", async () => {
    const { client, inserts } = makeServiceClient();
    const { executeOperation } = await import("../execute");
    const spec = op();
    const outcome = await executeOperation(client, undefined, spec, "rest");
    expect(outcome).toEqual({ ok: false, code: "unauthenticated", status: 401, message: "Not authenticated." });
    expect(inserts).toHaveLength(0);
    expect(spec.run).not.toHaveBeenCalled();
  });

  it("insufficient_scope → 403, audited as denied", async () => {
    const { client, inserts } = makeServiceClient();
    const { executeOperation } = await import("../execute");
    const spec = op({ toolName: "write", operation: "deen.prayer.log", requiredScope: "write" });
    const outcome = await executeOperation(client, READ_ONLY_AUTH, spec, "mcp");
    expect(outcome).toEqual({ ok: false, code: "insufficient_scope", status: 403, message: 'This token doesn\'t have "write" permission.' });
    expect(inserts[0]).toEqual(expect.objectContaining({ outcome: "denied" }));
    expect(spec.run).not.toHaveBeenCalled();
  });

  it("rate_limited → 429, audited as denied", async () => {
    const { client, inserts } = makeServiceClient({ rateLimited: true });
    const { executeOperation } = await import("../execute");
    const spec = op();
    const outcome = await executeOperation(client, GOOD_AUTH, spec, "mcp");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.code).toBe("rate_limited");
    expect(outcome.status).toBe(429);
    expect(outcome.message.length).toBeGreaterThan(0);
    expect(inserts[0]).toEqual(expect.objectContaining({ outcome: "denied" }));
    expect(spec.run).not.toHaveBeenCalled();
  });

  it("ToolInputError → invalid_input 400 with the message verbatim, audited as error", async () => {
    const { client, inserts } = makeServiceClient();
    const { executeOperation } = await import("../execute");
    const { ToolInputError } = await import("@/lib/mcp/tool-input-error");
    const outcome = await executeOperation(client, GOOD_AUTH, op({ run: async () => { throw new ToolInputError('Unknown entity "x". Known entities: prayer.'); } }), "rest");
    expect(outcome).toEqual({ ok: false, code: "invalid_input", status: 400, message: 'Unknown entity "x". Known entities: prayer.' });
    expect(inserts[0]).toEqual(expect.objectContaining({ outcome: "error", result_summary: expect.stringContaining("Unknown entity") }));
  });

  it("ToolNotFoundError → not_found 404 with the message verbatim", async () => {
    const { client } = makeServiceClient();
    const { executeOperation } = await import("../execute");
    const { ToolNotFoundError } = await import("@/lib/mcp/tool-input-error");
    const outcome = await executeOperation(client, GOOD_AUTH, op({ run: async () => { throw new ToolNotFoundError('No prayer found with id "p1".'); } }), "rest");
    expect(outcome).toEqual({ ok: false, code: "not_found", status: 404, message: 'No prayer found with id "p1".' });
  });

  it("any other throw → internal 500 with the generic message; the raw error is audited, never returned", async () => {
    const { client, inserts } = makeServiceClient();
    const { executeOperation } = await import("../execute");
    const outcome = await executeOperation(client, GOOD_AUTH, op({ run: async () => { throw new Error('relation "secret_table" does not exist'); } }), "rest");
    expect(outcome).toEqual({ ok: false, code: "internal", status: 500, message: "Something went wrong running that tool." });
    expect(inserts[0]).toEqual(expect.objectContaining({ outcome: "error", result_summary: expect.stringContaining("secret_table") }));
  });

  it("audit write failure after a SUCCESSFUL run → audit_failed 503 (the tool did run)", async () => {
    const { client } = makeServiceClient({ auditInsertError: { message: "insert failed" } });
    const { executeOperation } = await import("../execute");
    const spec = op();
    const outcome = await executeOperation(client, GOOD_AUTH, spec, "mcp");
    expect(spec.run).toHaveBeenCalled();
    expect(outcome).toEqual({ ok: false, code: "audit_failed", status: 503, message: "That may have worked, but it couldn't be recorded, so it's being reported as failed. Try again." });
  });

  it("audit write failure after a FAILED run is still audit_failed 503 (same precedence as runMcpTool)", async () => {
    const { client } = makeServiceClient({ auditInsertError: { message: "insert failed" } });
    const { executeOperation } = await import("../execute");
    const { ToolInputError } = await import("@/lib/mcp/tool-input-error");
    const outcome = await executeOperation(client, GOOD_AUTH, op({ run: async () => { throw new ToolInputError("bad"); } }), "mcp");
    expect(outcome).toEqual(expect.objectContaining({ ok: false, code: "audit_failed", status: 503 }));
  });

  it("an audit failure on the DENIAL path rejects, exactly as runMcpTool does today", async () => {
    const { client } = makeServiceClient({ auditInsertError: { message: "insert failed" } });
    const { executeOperation } = await import("../execute");
    await expect(executeOperation(client, READ_ONLY_AUTH, op({ requiredScope: "write" }), "mcp")).rejects.toThrow(/audit write failed/);
  });
});

describe("runMcpTool is a thin adapter over executeOperation", () => {
  it("maps a typed failure back to the same MCP error text", async () => {
    const { client } = makeServiceClient();
    const { runMcpTool } = await import("@/lib/mcp/tool-wrapper");
    const { ToolNotFoundError } = await import("@/lib/mcp/tool-input-error");
    const result = await runMcpTool(client, GOOD_AUTH, "read", "deen.prayer.read", "read", {}, async () => {
      throw new ToolNotFoundError('No prayer found with id "p1".');
    });
    expect(result).toEqual({ content: [{ type: "text", text: 'No prayer found with id "p1".' }], isError: true });
  });

  it("returns the tool's own result object on success", async () => {
    const { client } = makeServiceClient();
    const { runMcpTool } = await import("@/lib/mcp/tool-wrapper");
    const result = await runMcpTool(client, GOOD_AUTH, "read", "deen.prayer.read", "read", {}, async () => ({ result: TOOL_RESULT, summary: "s" }));
    expect(result).toBe(TOOL_RESULT);
  });
});

describe("P4-12: the transport reaches the audit row", () => {
  it("every audit row a call writes (ok and denied) carries the adapter's transport", async () => {
    const { executeOperation } = await import("../execute");
    const ok = makeServiceClient();
    await executeOperation(ok.client, GOOD_AUTH, op(), "rest");
    expect(ok.inserts.map((r) => r.transport)).toEqual(["rest"]);

    const denied = makeServiceClient();
    await executeOperation(denied.client, READ_ONLY_AUTH, op({ requiredScope: "write" }), "scheduler");
    expect(denied.inserts.map((r) => [r.outcome, r.transport])).toEqual([["denied", "scheduler"]]);

    const mcp = makeServiceClient();
    await executeOperation(mcp.client, GOOD_AUTH, op(), "mcp");
    expect(mcp.inserts[0].transport).toBe("mcp");
  });
});

describe("P4-14: rate-limit lanes and Retry-After", () => {
  it("MCP and REST calls consume the INTERACTIVE per-token and per-user buckets", async () => {
    const { executeOperation } = await import("../execute");
    for (const transport of ["mcp", "rest"] as const) {
      const svc = makeServiceClient();
      await executeOperation(svc.client, GOOD_AUTH, op(), transport);
      expect(svc.rpcCalls[0].name).toBe("mcp_rate_limit_consume");
      expect(svc.rpcCalls[0].args.p_keys).toEqual(["tok:tok-1", "user:user-1"]);
    }
  });

  it("scheduled fires consume the SCHEDULER buckets, never the interactive ones", async () => {
    const { executeOperation } = await import("../execute");
    const svc = makeServiceClient();
    await executeOperation(svc.client, GOOD_AUTH, op(), "scheduler");
    expect(svc.rpcCalls[0].args.p_keys).toEqual(["sched-tok:tok-1", "sched-user:user-1"]);
  });

  it("a rate-limited result carries retryAfterSeconds, and the message tells the caller when to retry", async () => {
    const { executeOperation } = await import("../execute");
    const svc = makeServiceClient({ rateLimited: true });
    const outcome = await executeOperation(svc.client, GOOD_AUTH, op(), "rest");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.retryAfterSeconds).toBe(23);
    expect(outcome.message).toMatch(/retry after 23s/i);
  });

  it("a scope denial does not touch the rate limiter at all (it never consumes budget)", async () => {
    const { executeOperation } = await import("../execute");
    const svc = makeServiceClient();
    await executeOperation(svc.client, READ_ONLY_AUTH, op({ requiredScope: "write" }), "mcp");
    expect(svc.rpcCalls).toHaveLength(0);
  });
});
