import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWriteAction, listWriteActions } from "../write-registry";

// Sunday 2026-10-25 08:00 in Chicago. The most recently COMPLETED week starts Sunday 2026-10-18; the current week starts 2026-10-25.
const now = new Date("2026-10-25T13:00:00.000Z");
const TZ = "America/Chicago";
const CARD = "11111111-1111-4111-8111-111111111111";

function fake(data: unknown = 1, error: unknown = null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return { data, error };
  });
  return { client: { rpc, from: vi.fn() } as unknown as SupabaseClient, calls };
}
const ctx = (client: SupabaseClient, extra: Record<string, unknown> = {}) => ({ userClient: client, userId: "user-1", timezone: TZ, now, ...extra });

describe("review.weekly_narrative", () => {
  const act = (a: string) => getWriteAction("review", "weekly_narrative", a)!;

  it("has write and clear", () => {
    expect(listWriteActions("review", "weekly_narrative").sort()).toEqual(["clear", "write"]);
  });

  it("defaults to the most recently completed week", async () => {
    const { client, calls } = fake();
    await act("write").handler(ctx(client, { tokenId: "tok-1" }), { text: "A good week." });
    expect(calls[0]).toEqual({ fn: "write_agent_weekly_narrative", args: { p_week_start: "2026-10-18", p_text: "A good week.", p_token_id: "tok-1" } });
  });

  it("accepts the current week too, and refuses any other week, a non-Sunday, or a malformed date", async () => {
    const { client, calls } = fake();
    await act("write").handler(ctx(client), { text: "x", week_start: "2026-10-25" });
    expect(calls[0]!.args.p_week_start).toBe("2026-10-25");
    for (const week_start of ["2026-10-11", "2026-11-01", "2026-10-19", "yesterday", "2026-02-30"]) {
      await expect(act("write").handler(ctx(client), { text: "x", week_start })).rejects.toThrow(/patch\.week_start/);
    }
    expect(calls).toHaveLength(1);
  });

  it("enforces 1..2000 characters", async () => {
    const { client } = fake();
    await expect(act("write").handler(ctx(client), { text: "  " })).rejects.toThrow(/patch\.text/);
    await expect(act("write").handler(ctx(client), { text: "a".repeat(2001) })).rejects.toThrow(/2000/);
    await expect(act("write").handler(ctx(client), { text: "a".repeat(2000) })).resolves.toBeTruthy();
  });

  it("sends no user id even if the patch carries one", async () => {
    const { client, calls } = fake();
    await act("write").handler(ctx(client), { text: "x", user_id: "someone-else" });
    expect(Object.keys(calls[0]!.args).sort()).toEqual(["p_text", "p_token_id", "p_week_start"]);
  });

  it("clear says plainly when there is nothing agent-written", async () => {
    const { client } = fake(0);
    await expect(act("clear").handler(ctx(client), {})).rejects.toThrow(/no agent-written/i);
  });
});

describe("self_mastery.day_connection", () => {
  const act = (a: string) => getWriteAction("self_mastery", "day_connection", a)!;

  it("has write and clear", () => {
    expect(listWriteActions("self_mastery", "day_connection").sort()).toEqual(["clear", "write"]);
  });

  it("writes one line for a card for the local today", async () => {
    const { client, calls } = fake();
    await act("write").handler(ctx(client, { tokenId: "tok-2" }), { card_id: CARD, text: "  Your 7:00 PM stats quiz is this idea in action.  " });
    expect(calls[0]).toEqual({
      fn: "write_agent_day_connection",
      args: { p_card_id: CARD, p_date: "2026-10-25", p_text: "Your 7:00 PM stats quiz is this idea in action.", p_token_id: "tok-2" },
    });
  });

  it("refuses a bad card id, a multi-line or over-220-character line, and a date that is not today or tomorrow", async () => {
    const { client } = fake();
    await expect(act("write").handler(ctx(client), { card_id: "nope", text: "x" })).rejects.toThrow(/patch\.card_id/);
    await expect(act("write").handler(ctx(client), { card_id: CARD, text: "one\ntwo" })).rejects.toThrow(/one line/);
    await expect(act("write").handler(ctx(client), { card_id: CARD, text: "a".repeat(221) })).rejects.toThrow(/220/);
    await expect(act("write").handler(ctx(client), { card_id: CARD, text: "ok", date: "2026-10-20" })).rejects.toThrow(/patch\.date/);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a card that is not the caller's own reads as not found (the function writes nothing and returns 0)", async () => {
    const { client } = fake(0);
    await expect(act("write").handler(ctx(client), { card_id: CARD, text: "ok" })).rejects.toThrow(/No lesson card/);
  });

  it("clear needs a card id and reports when nothing was there", async () => {
    const { client, calls } = fake(0);
    await expect(act("clear").handler(ctx(client), {})).rejects.toThrow(/patch\.card_id/);
    await expect(act("clear").handler(ctx(client), { card_id: CARD })).rejects.toThrow(/no agent-written/i);
    expect(calls[0]!.fn).toBe("clear_agent_day_connection");
  });
});

describe("migrations 275 / 276 — tenancy", () => {
  for (const [file, fns] of [
    ["supabase/migrations/275_agent_weekly_narrative.sql", ["write_agent_weekly_narrative", "clear_agent_weekly_narrative"]],
    ["supabase/migrations/276_agent_day_connection.sql", ["write_agent_day_connection", "clear_agent_day_connection"]],
  ] as const) {
    it(`${file} acts as auth.uid(), takes no user id and is closed to anon`, () => {
      const sql = readFileSync(file, "utf8");
      expect(sql).toContain("auth.uid()");
      expect(sql).not.toMatch(/p_user_id/);
      for (const fn of fns) expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`, "i"));
    });
  }

  it("276 ties a connection to the SAME user's card (composite FK) and checks ownership before writing", () => {
    const sql = readFileSync("supabase/migrations/276_agent_day_connection.sql", "utf8");
    expect(sql).toMatch(/foreign key \(user_id, card_id\) references public\.cards \(user_id, id\)/);
    expect(sql).toMatch(/from public\.cards where id = p_card_id and user_id = v_uid/);
  });
});
