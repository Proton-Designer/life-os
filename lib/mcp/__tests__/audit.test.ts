import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditRow } from "../audit";

function makeClient(resolved: { error: unknown }) {
  const insert = vi.fn((row: Record<string, unknown>) => ({ then: (r: (v: typeof resolved) => void) => r(resolved), row }));
  const from = vi.fn(() => ({ insert }));
  return { client: { from } as unknown as SupabaseClient, from, insert };
}

describe("writeAuditRow", () => {
  it("inserts exactly the given fields into mcp_audit_log, including the resolved operation — never just the generic tool name", async () => {
    const { client, from, insert } = makeClient({ error: null });

    await writeAuditRow(client, {
      userId: "user-1",
      tokenId: "tok-1",
      toolName: "read",
      operation: "deen.prayer.read",
      args: { q: 1 },
      outcome: "ok",
      resultSummary: "done",
    });

    expect(from).toHaveBeenCalledWith("mcp_audit_log");
    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      token_id: "tok-1",
      tool_name: "read",
      operation: "deen.prayer.read",
      args: { q: 1 },
      outcome: "ok",
      result_summary: "done",
      transport: "mcp",
    });
  });

  it("P4-12: records the transport the call arrived on (migration 215), defaulting to mcp", async () => {
    const { client, insert } = makeClient({ error: null });
    await writeAuditRow(client, { userId: "u", tokenId: "t", toolName: "write", operation: "x.y.save", args: {}, outcome: "ok", transport: "scheduler" });
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ transport: "scheduler" }));
    await writeAuditRow(client, { userId: "u", tokenId: "t", toolName: "read", operation: "x.y.read", args: {}, outcome: "ok", transport: "rest" });
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ transport: "rest" }));
  });

  it("defaults args to {} and result_summary to null when omitted", async () => {
    const { client, insert } = makeClient({ error: null });
    await writeAuditRow(client, { userId: "u", tokenId: null, toolName: "t", operation: "x.y.read", args: undefined, outcome: "ok" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ args: {}, result_summary: null, token_id: null }));
  });

  it("THROWS on a DB error rather than swallowing it — the whole point is that a failed write must fail the call", async () => {
    const { client } = makeClient({ error: { message: "insert failed" } });
    await expect(
      writeAuditRow(client, { userId: "u", tokenId: "t", toolName: "x", operation: "x.y.read", args: {}, outcome: "error" }),
    ).rejects.toThrow(/insert failed/);
  });
});
