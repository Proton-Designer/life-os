import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWriteAction, listWriteEntities, listWriteActions, WRITE_REGISTRY } from "../write-registry";

function makeClient(opts: { existing?: { completed: boolean } | null; id?: string; error?: unknown } = {}) {
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => ({ data: opts.existing ?? null, error: null }));
    chain.upsert = vi.fn(() => chain);
    chain.single = vi.fn(async () => ({
      data: opts.error ? null : { id: opts.id ?? "row-1", logged_at: "2026-09-08T12:00:00.000Z" },
      error: opts.error ?? null,
    }));
    return chain;
  });
  return { from } as unknown as SupabaseClient;
}

describe("write-registry dispatch shape", () => {
  it("getWriteAction finds deen.prayer.log", () => {
    expect(getWriteAction("deen", "prayer", "log")).not.toBeNull();
  });

  it("getWriteAction returns null for deen.prayer.unlog — deliberately unimplemented, not a typo", () => {
    expect(getWriteAction("deen", "prayer", "unlog")).toBeNull();
  });

  it("getWriteAction returns null for an unknown domain/entity/action at every level", () => {
    expect(getWriteAction("fitness", "prayer", "log")).toBeNull();
    expect(getWriteAction("deen", "workout", "log")).toBeNull();
    expect(getWriteAction("deen", "prayer", "delete")).toBeNull();
  });

  it("listWriteEntities/listWriteActions reflect exactly what's registered", () => {
    expect(listWriteEntities("deen").sort()).toEqual(["adhkar", "prayer", "sunnah_log"]);
    expect(listWriteActions("deen", "prayer")).toEqual(["log"]);
    expect(listWriteActions("deen", "sunnah_log")).toEqual(["toggle"]);
    expect(listWriteActions("deen", "adhkar")).toEqual(["toggle"]);
  });

  it("listWriteEntities returns [] for a domain with no write surface at all", () => {
    expect(listWriteEntities("self_mastery")).toEqual([]);
  });
});

describe("deen.prayer.log handler", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("validates patch.date/prayer_name/status and calls through to markPrayerCore", async () => {
    const action = getWriteAction("deen", "prayer", "log")!;
    const client = makeClient({ id: "p-1" });

    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now },
      { date: "2026-09-08", prayer_name: "fajr", status: "on_time" },
    );

    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ id: "p-1", date: "2026-09-08", status: "on_time" });
    expect(outcome.summary).toMatch(/fajr/);
  });

  it("REJECTS a missing patch.date", async () => {
    const action = getWriteAction("deen", "prayer", "log")!;
    const client = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { prayer_name: "fajr", status: "on_time" }),
    ).rejects.toThrow(/patch\.date/i);
  });

  it("REJECTS an invalid prayer_name", async () => {
    const action = getWriteAction("deen", "prayer", "log")!;
    const client = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", prayer_name: "jummah", status: "on_time" }),
    ).rejects.toThrow(/prayer_name/i);
  });

  it("REJECTS an invalid status — never silently coerced", async () => {
    const action = getWriteAction("deen", "prayer", "log")!;
    const client = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", prayer_name: "fajr", status: "pending" }),
    ).rejects.toThrow(/status/i);
  });

  it("propagates the future-date guard from markPrayerCore (UTC rollover already pinned in actions-core.test.ts)", async () => {
    const action = getWriteAction("deen", "prayer", "log")!;
    const client = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2099-01-01", prayer_name: "fajr", status: "on_time" }),
    ).rejects.toThrow(/after today/i);
  });
});

describe("deen.sunnah_log.toggle handler", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("validates patch.date/prayer_name/slot and calls through to toggleSunnahCore", async () => {
    const action = getWriteAction("deen", "sunnah_log", "toggle")!;
    const client = makeClient({ existing: { completed: false }, id: "s-1" });

    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now },
      { date: "2026-09-08", prayer_name: "fajr", slot: "before" },
    );

    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ id: "s-1", completed: true });
  });

  it("REJECTS an invalid slot", async () => {
    const action = getWriteAction("deen", "sunnah_log", "toggle")!;
    const client = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", prayer_name: "fajr", slot: "during" }),
    ).rejects.toThrow(/slot/i);
  });
});

describe("deen.adhkar.toggle handler", () => {
  const now = new Date("2026-09-08T20:00:00.000Z");

  it("validates patch.date/period and calls through to toggleAdhkarCore — no timezone/now used for the date guard (adhkar has none)", async () => {
    const action = getWriteAction("deen", "adhkar", "toggle")!;
    const client = makeClient({ existing: { completed: true }, id: "a-1" });

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2099-01-01", period: "morning" });

    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ id: "a-1", completed: false });
  });

  it("REJECTS an invalid period", async () => {
    const action = getWriteAction("deen", "adhkar", "toggle")!;
    const client = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", period: "afternoon" }),
    ).rejects.toThrow(/period/i);
  });
});

describe("WRITE_REGISTRY shape — the deliverable the team-lead asked for", () => {
  it("every registered action's handler is an actual function, not a stub", () => {
    for (const domain of Object.values(WRITE_REGISTRY)) {
      for (const entity of Object.values(domain.entities)) {
        for (const action of Object.values(entity.actions)) {
          expect(typeof action.handler).toBe("function");
        }
      }
    }
  });
});
