import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { AuthInfoLike } from "../auth-info";

/** `CallToolResult.content` is a union of content-block types; every result this module ever produces is plain text, so narrow once here rather than casting at each call site. */
function textOf(result: CallToolResult): string {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error(`Expected a text content block, got: ${JSON.stringify(block)}`);
  return block.text;
}

const mintSessionJwtMock = vi.fn(async (_userId: string) => "fake.jwt.token");
const buildUserScopedClientMock = vi.fn((_jwt: string) => ({ __fake: "user-scoped-client" }));
vi.mock("../session", () => ({
  mintSessionJwt: mintSessionJwtMock,
  buildUserScopedClient: buildUserScopedClientMock,
}));

/**
 * A fake service-role client covering exactly the two query shapes
 * lib/mcp/tool-wrapper.ts's dependencies make against `mcp_audit_log`:
 * rate-limit's `.select(..., {count}).eq().gte()` (a thenable, no terminal
 * call) and audit's `.insert(...)` (also a thenable). Records every insert
 * so tests can assert exactly what was logged.
 */
function makeServiceClient(opts: { rateLimitCount?: number; rateLimitError?: unknown; auditInsertError?: unknown } = {}) {
  const inserts: Record<string, unknown>[] = [];
  const from = vi.fn((_table: string) => {
    const chain: Record<string, unknown> = {};
    const selectResolved = { count: opts.rateLimitCount ?? 0, error: opts.rateLimitError ?? null };
    for (const m of ["select", "eq", "gte"]) {
      chain[m] = vi.fn(() => chain);
    }
    chain.then = (resolve: (v: typeof selectResolved) => void) => resolve(selectResolved);
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      inserts.push(row);
      const resolved = { error: opts.auditInsertError ?? null };
      return { then: (resolve: (v: typeof resolved) => void) => resolve(resolved) };
    });
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, inserts };
}

const GOOD_AUTH: AuthInfoLike = { scopes: ["read", "write"], extra: { userId: "user-1", tokenId: "tok-1" } };
const READ_ONLY_AUTH: AuthInfoLike = { scopes: ["read"], extra: { userId: "user-1", tokenId: "tok-1" } };

const okFn = vi.fn(async () => ({
  result: { content: [{ type: "text" as const, text: "ok" }] },
  summary: "did the thing",
}));

beforeEach(() => {
  mintSessionJwtMock.mockClear();
  buildUserScopedClientMock.mockClear();
  okFn.mockClear();
});

describe("runMcpTool", () => {
  it("REJECTS when there is no auth info at all, and writes no audit row (no userId to attribute one to)", async () => {
    const { client, inserts } = makeServiceClient();
    const { runMcpTool } = await import("../tool-wrapper");

    const result = await runMcpTool(client, undefined, "get_profile", "test.get_profile", "read", {}, okFn);

    expect(result.isError).toBe(true);
    expect(inserts).toHaveLength(0);
    expect(okFn).not.toHaveBeenCalled();
  });

  it("REJECTS a read-only token against a tool requiring write, and audits it as DENIED", async () => {
    const { client, inserts } = makeServiceClient();
    const { runMcpTool } = await import("../tool-wrapper");

    const result = await runMcpTool(client, READ_ONLY_AUTH, "some_write_tool", "test.write_thing", "write", { x: 1 }, okFn);

    expect(result.isError).toBe(true);
    expect(okFn).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual(
      expect.objectContaining({ user_id: "user-1", token_id: "tok-1", tool_name: "some_write_tool", operation: "test.write_thing", outcome: "denied" }),
    );
  });

  it("REJECTS when the rate limit is exceeded, and audits it as DENIED, without running the tool", async () => {
    const { client, inserts } = makeServiceClient({ rateLimitCount: 999 });
    const { runMcpTool } = await import("../tool-wrapper");

    const result = await runMcpTool(client, GOOD_AUTH, "get_profile", "test.get_profile", "read", {}, okFn);

    expect(result.isError).toBe(true);
    expect(okFn).not.toHaveBeenCalled();
    expect(inserts[0]).toEqual(expect.objectContaining({ outcome: "denied" }));
  });

  it("REJECTS (fails closed) when the rate-limit check itself errors, rather than letting the call through unlimited", async () => {
    const { client } = makeServiceClient({ rateLimitError: { message: "db down" } });
    const { runMcpTool } = await import("../tool-wrapper");

    const result = await runMcpTool(client, GOOD_AUTH, "get_profile", "test.get_profile", "read", {}, okFn);

    expect(result.isError).toBe(true);
    expect(okFn).not.toHaveBeenCalled();
  });

  it("on a real success, mints a session, builds a user-scoped client, runs the tool, and audits OK", async () => {
    const { client, inserts } = makeServiceClient();
    const { runMcpTool } = await import("../tool-wrapper");

    const result = await runMcpTool(client, GOOD_AUTH, "get_profile", "test.get_profile", "read", { q: "me" }, okFn);

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe("ok");
    expect(mintSessionJwtMock).toHaveBeenCalledWith("user-1");
    expect(buildUserScopedClientMock).toHaveBeenCalledWith("fake.jwt.token");
    expect(okFn).toHaveBeenCalledWith({ __fake: "user-scoped-client" }, "user-1");
    expect(inserts[0]).toEqual(
      expect.objectContaining({ user_id: "user-1", token_id: "tok-1", tool_name: "get_profile", operation: "test.get_profile", outcome: "ok", args: { q: "me" } }),
    );
  });

  it("a tool that THROWS is audited as an error, and the client gets a generic message, not the raw internal error", async () => {
    const { client, inserts } = makeServiceClient();
    const throwingFn = vi.fn(async () => {
      throw new Error("leaked a postgres column name here, hypothetically");
    });
    const { runMcpTool } = await import("../tool-wrapper");

    const result = await runMcpTool(client, GOOD_AUTH, "get_profile", "test.get_profile", "read", {}, throwingFn);

    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain("postgres column name");
    expect(inserts[0]).toEqual(expect.objectContaining({ outcome: "error", result_summary: expect.stringContaining("leaked") }));
  });

  it("a tool call that succeeds but whose audit write fails is reported as FAILED, not as a silent success", async () => {
    const { client } = makeServiceClient({ auditInsertError: { message: "write failed" } });
    const { runMcpTool } = await import("../tool-wrapper");

    const result = await runMcpTool(client, GOOD_AUTH, "get_profile", "test.get_profile", "read", {}, okFn);

    expect(okFn).toHaveBeenCalled(); // the tool DID run
    expect(result.isError).toBe(true); // but the caller is told it failed, because it couldn't be recorded
    expect(textOf(result)).toMatch(/couldn't be recorded/i);
  });
});
