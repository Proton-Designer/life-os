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


// Deen Mode gate (lib/mcp/deen-gate.ts) is covered by its own test file; these
// suites exercise the tools' behaviour for an account with Deen Mode ON, and
// their fake clients have no profiles table.
vi.mock("@/lib/mcp/deen-gate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp/deen-gate")>()),
  assertDeenAvailable: async () => {},
  readDeenMode: async () => true,
}));

describe("resolveWriteOperation", () => {
  it("is domain.entity.action", () => {
    expect(resolveWriteOperation({ domain: "deen", entity: "prayer", action: "log" })).toBe("deen.prayer.log");
  });
});

describe("writeTool — dispatch + error shape", () => {
  it("REJECTS an unknown domain with no writable entities, naming how to discover what's readable", async () => {
    // self_mastery USED to be the example here -- it now has a real write
    // surface (grade a review, record a verdict, log a self-explanation).
    // calendar is a genuine zero-entity aggregation domain (lib/mcp/
    // registry.ts: "it has no table of its own"), never registered for
    // write at all.
    const client = makeClient();
    await expect(writeTool(client, "user-1", { domain: "calendar", entity: "event", action: "write" })).rejects.toThrow(
      /no writable entities.*calendar/i,
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
    // P4-03: prayer.log's `date` now defaults to the account's local today,
    // so the first missing field the handler reports is prayer_name.
    const client = makeClient();
    await expect(writeTool(client, "user-1", { domain: "deen", entity: "prayer", action: "log" })).rejects.toThrow(/patch\.prayer_name/i);
  });
});

describe("writeTool — P4-03 patch.date defaults to the account's LOCAL today", () => {
  function capturingClient(timezone: string) {
    const upserts: Record<string, unknown>[] = [];
    const from = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () =>
        table === "profiles" ? { data: { timezone }, error: null } : table === "schedule_events" ? { data: { domain: "school" }, error: null } : { data: null, error: null },
      );
      chain.upsert = vi.fn((row: Record<string, unknown>) => {
        upserts.push(row);
        return chain;
      });
      chain.single = vi.fn(async () => ({ data: { id: "p-1", logged_at: "2026-09-15T03:30:00.000Z" }, error: null }));
      return chain;
    });
    return { client: { from } as unknown as SupabaseClient, upserts };
  }

  it("omitted date on a log-shaped action becomes localDateString(now, tz) — 22:30 Chicago is still the 14th, not UTC's 15th", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T03:30:00.000Z"));
    try {
      const { client, upserts } = capturingClient("America/Chicago");
      const outcome = await writeTool(client, "user-1", { domain: "deen", entity: "prayer", action: "log", patch: { prayer_name: "isha", status: "on_time" } });
      expect(upserts[0]).toMatchObject({ date: "2026-09-14", prayer_name: "isha" });
      const block = outcome.result.content[0];
      if (block.type !== "text") throw new Error("expected text");
      expect(JSON.parse(block.text)).toMatchObject({ date: "2026-09-14" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("an explicit date is never overridden", async () => {
    const { client, upserts } = capturingClient("America/Chicago");
    await writeTool(client, "user-1", { domain: "deen", entity: "prayer", action: "log", patch: { date: "2026-09-01", prayer_name: "fajr", status: "on_time" } });
    expect(upserts[0]).toMatchObject({ date: "2026-09-01" });
  });

  it("is NEVER applied where a silent 'today' could change the wrong row (school.schedule_event.cancel_occurrence still requires date)", async () => {
    const { client } = capturingClient("America/Chicago");
    await expect(writeTool(client, "user-1", { domain: "school", entity: "schedule_event", action: "cancel_occurrence", id: "e-1", patch: {} })).rejects.toThrow(/patch\.date/i);
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

  it("requires patch.prayer_name, same as log (patch.date defaults to local today since P4-03)", async () => {
    const client = makeClient();
    await expect(writeTool(client, "user-1", { domain: "deen", entity: "prayer", action: "unlog" })).rejects.toThrow(/patch\.prayer_name/i);
  });
});
