import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWriteAction, listWriteActions } from "../write-registry";

// 2026-10-25 03:30 UTC is still the evening of 2026-10-24 in Chicago (UTC-5): "today" must be the LOCAL day.
const now = new Date("2026-10-25T03:30:00.000Z");
const TZ = "America/Chicago";

type RpcCall = { fn: string; args: Record<string, unknown> };
function fakeClient(rpcResult: { data: unknown; error: unknown } = { data: 1, error: null }) {
  const calls: RpcCall[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return rpcResult;
  });
  return { client: { rpc, from: vi.fn() } as unknown as SupabaseClient, calls };
}
function ctx(client: SupabaseClient, extra: Record<string, unknown> = {}) {
  return { userClient: client, userId: "user-1", timezone: TZ, now, ...extra };
}
function write() {
  return getWriteAction("day", "morning_brief", "write")!;
}

describe("day.morning_brief — registered", () => {
  it("has write and clear", () => {
    expect(listWriteActions("day", "morning_brief").sort()).toEqual(["clear", "write"]);
  });
});

describe("day.morning_brief.write — date guard", () => {
  it("defaults to the user's LOCAL today, never the raw UTC day", async () => {
    const { client, calls } = fakeClient();
    await write().handler(ctx(client), { text: "Good morning." });
    expect(calls[0]!.args.p_date).toBe("2026-10-24");
  });

  it("accepts tomorrow (a late-night task writing the next brief)", async () => {
    const { client, calls } = fakeClient();
    await write().handler(ctx(client), { text: "Tomorrow.", date: "2026-10-25" });
    expect(calls[0]!.args.p_date).toBe("2026-10-25");
  });

  it("refuses yesterday, two days ahead, and a malformed date, without touching the database", async () => {
    const { client } = fakeClient();
    for (const date of ["2026-10-23", "2026-10-26", "10/24/2026", "2026-02-30"]) {
      await expect(write().handler(ctx(client), { text: "x", date })).rejects.toThrow(/patch\.date/);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("day.morning_brief.write — text", () => {
  it("trims, keeps paragraphs and line breaks", async () => {
    const { client, calls } = fakeClient();
    await write().handler(ctx(client), { text: "  Line one.\n\nLine two.  " });
    expect(calls[0]!.args.p_text).toBe("Line one.\n\nLine two.");
  });

  it("refuses missing, blank and non-string text", async () => {
    const { client } = fakeClient();
    for (const text of [undefined, "", "   \n ", 42]) {
      await expect(write().handler(ctx(client), { text })).rejects.toThrow(/patch\.text/);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("accepts exactly 2000 characters and refuses 2001", async () => {
    const { client } = fakeClient();
    await expect(write().handler(ctx(client), { text: "a".repeat(2000) })).resolves.toBeTruthy();
    await expect(write().handler(ctx(client), { text: "a".repeat(2001) })).rejects.toThrow(/2000/);
  });
});

describe("day.morning_brief.write — upsert, source mark, tenancy", () => {
  it("sends the token id (the database names the source) and NO user id", async () => {
    const { client, calls } = fakeClient();
    await write().handler(ctx(client, { tokenId: "tok-9" }), { text: "Hi", user_id: "someone-else" });
    expect(calls[0]!.fn).toBe("write_agent_morning_brief");
    expect(calls[0]!.args).toEqual({ p_date: "2026-10-24", p_text: "Hi", p_token_id: "tok-9" });
  });

  it("a database error is not swallowed", async () => {
    const { client } = fakeClient({ data: null, error: { message: "boom", code: "XX000" } });
    await expect(write().handler(ctx(client), { text: "Hi" })).rejects.toBeTruthy();
  });

  it("migration 274 scopes everything to auth.uid(), takes no user id, and is closed to anon", () => {
    const sql = readFileSync("supabase/migrations/274_agent_morning_brief.sql", "utf8");
    expect(sql).toContain("auth.uid()");
    expect(sql).not.toMatch(/p_user_id/);
    expect(sql).toMatch(/revoke all on function public\.write_agent_morning_brief\(date, text, uuid\) from public, anon/i);
    expect(sql).toMatch(/revoke all on function public\.clear_agent_morning_brief\(date\) from public, anon/i);
    // the token lookup that names the source can only see the caller's OWN token
    expect(sql).toMatch(/mcp_access_tokens[\s\S]*user_id = v_uid/);
  });
});

describe("day.morning_brief.clear", () => {
  it("clears the agent brief for the local today by default and reports it", async () => {
    const { client, calls } = fakeClient({ data: 1, error: null });
    const outcome = await getWriteAction("day", "morning_brief", "clear")!.handler(ctx(client), {});
    expect(calls[0]).toEqual({ fn: "clear_agent_morning_brief", args: { p_date: "2026-10-24" } });
    expect(outcome.summary).toMatch(/cleared/);
  });

  it("says plainly when there was no agent brief to clear", async () => {
    const { client } = fakeClient({ data: 0, error: null });
    await expect(getWriteAction("day", "morning_brief", "clear")!.handler(ctx(client), {})).rejects.toThrow(/no agent-written/i);
  });
});
