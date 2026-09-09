import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeTool, resolveWriteOperation } from "../write";

function makeClient(opts: { timezone?: string | null; id?: string } = {}) {
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () =>
      table === "profiles" ? { data: opts.timezone ? { timezone: opts.timezone } : null, error: null } : { data: null, error: null },
    );
    chain.upsert = vi.fn(() => chain);
    chain.single = vi.fn(async () => ({ data: { id: opts.id ?? "row-1", logged_at: "2026-09-08T12:00:00.000Z" }, error: null }));
    return chain;
  });
  return { from } as unknown as SupabaseClient;
}

describe("resolveWriteOperation", () => {
  it("is domain.entity.action", () => {
    expect(resolveWriteOperation({ domain: "deen", entity: "prayer", action: "log" })).toBe("deen.prayer.log");
  });
});

describe("writeTool — dispatch + error shape", () => {
  it("REJECTS an unknown domain with no writable entities, naming how to discover what's readable", async () => {
    const client = makeClient();
    await expect(writeTool(client, "user-1", { domain: "self_mastery", entity: "source_chunks", action: "write" })).rejects.toThrow(
      /no writable entities.*self_mastery/i,
    );
  });

  it("REJECTS an unknown entity for a known writable domain, naming the writable entities", async () => {
    const client = makeClient();
    await expect(writeTool(client, "user-1", { domain: "deen", entity: "workout", action: "log" })).rejects.toThrow(/unknown writable entity.*workout/i);
    await expect(writeTool(client, "user-1", { domain: "deen", entity: "workout", action: "log" })).rejects.toThrow(/prayer/);
  });

  it("REJECTS an unknown action for a known entity, naming the available actions", async () => {
    // "unlog" USED to be the example here -- R9 wired it for real (see
    // write.test.ts's own dedicated describe block below), so it's no
    // longer an unknown action. A genuinely nonexistent one instead.
    const client = makeClient();
    await expect(writeTool(client, "user-1", { domain: "deen", entity: "prayer", action: "snooze" })).rejects.toThrow(/unknown action.*snooze/i);
    await expect(writeTool(client, "user-1", { domain: "deen", entity: "prayer", action: "snooze" })).rejects.toThrow(/log/);
  });

  it("fetches the timezone ONCE and passes it into the handler — dispatches deen.prayer.log through to a real result", async () => {
    const client = makeClient({ timezone: "America/Chicago", id: "p-9" });

    const outcome = await writeTool(client, "user-1", {
      domain: "deen",
      entity: "prayer",
      action: "log",
      patch: { date: "2026-09-08", prayer_name: "fajr", status: "on_time" },
    });

    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ id: "p-9", date: "2026-09-08", status: "on_time" });
  });

  it("defaults to UTC when the account has no timezone set yet, rather than throwing", async () => {
    const client = makeClient({ timezone: null });
    await expect(
      writeTool(client, "user-1", { domain: "deen", entity: "prayer", action: "log", patch: { date: "2026-09-08", prayer_name: "fajr", status: "on_time" } }),
    ).resolves.not.toThrow();
  });

  it("defaults patch to {} when omitted, so the handler's own validation (not a crash here) reports the missing fields", async () => {
    const client = makeClient();
    await expect(writeTool(client, "user-1", { domain: "deen", entity: "prayer", action: "log" })).rejects.toThrow(/patch\.date/i);
  });
});

describe("writeTool — deen.prayer.unlog (R9)", () => {
  it("dispatches through to a real result -- status 'unlogged', never a DELETE", async () => {
    const client = makeClient({ timezone: "America/Chicago", id: "p-9" });

    const outcome = await writeTool(client, "user-1", {
      domain: "deen",
      entity: "prayer",
      action: "unlog",
      patch: { date: "2026-09-08", prayer_name: "fajr" },
    });

    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ id: "p-9", date: "2026-09-08", status: "unlogged" });
  });

  it("requires patch.date and patch.prayer_name, same as log", async () => {
    const client = makeClient();
    await expect(writeTool(client, "user-1", { domain: "deen", entity: "prayer", action: "unlog" })).rejects.toThrow(/patch\.date/i);
  });
});
