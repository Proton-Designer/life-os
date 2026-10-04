import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { assertDeenAvailable, readDeenMode, DEEN_OFF_MESSAGE } from "../deen-gate";
import { readTool } from "../tools/read";
import { writeTool } from "../tools/write";
import { listCapabilitiesTool } from "../tools/list-capabilities";
import { widgetManageTool } from "../tools/widget-manage";
import { schedulerManageTool } from "../tools/scheduler-manage";
import { buildAccountMap } from "@/lib/agent-api/account-map";
import { ToolInputError } from "../tool-input-error";

/**
 * Deen Mode gate for the AI connector (user decision A2): OFF hides the deen
 * domain and refuses deen reads/writes BEFORE any deen table is touched; ON
 * is unchanged. Uses the REAL gate (other suites mock it out).
 */
function fakeClient(deenMode: boolean | null | "error") {
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "order", "range", "gte", "lte", "limit", "upsert", "insert", "update"]) chain[m] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () =>
      table === "profiles"
        ? deenMode === "error"
          ? { data: null, error: { message: "boom" } }
          : { data: { deen_mode: deenMode, timezone: "UTC", onboarding_completed: true, location_lat: 1, display_name: "x" }, error: null }
        : { data: null, error: null },
    );
    chain.single = chain.maybeSingle;
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 });
    return chain;
  });
  return { client: { from, rpc: vi.fn() } as unknown as SupabaseClient, tables };
}

const NOW = new Date("2026-10-04T15:00:00.000Z");

describe("assertDeenAvailable / readDeenMode", () => {
  it("refuses deen when OFF / null / on error (fails closed), allows when ON", async () => {
    for (const mode of [false, null, "error"] as const) {
      const { client } = fakeClient(mode);
      expect(await readDeenMode(client, "u")).toBe(false);
      await expect(assertDeenAvailable(client, "u", "deen")).rejects.toThrow(DEEN_OFF_MESSAGE);
    }
    const on = fakeClient(true);
    await expect(assertDeenAvailable(on.client, "u", "deen")).resolves.toBeUndefined();
  });

  it("any other domain: no query at all", async () => {
    const { client, tables } = fakeClient(false);
    await assertDeenAvailable(client, "u", "fitness");
    expect(tables).toEqual([]);
  });

  it("the refusal is a ToolInputError (structured, caller-safe)", async () => {
    const { client } = fakeClient(false);
    await expect(assertDeenAvailable(client, "u", "deen")).rejects.toBeInstanceOf(ToolInputError);
  });
});

describe("read / write", () => {
  it("OFF: reading a deen entity is refused and no deen table is queried", async () => {
    const { client, tables } = fakeClient(false);
    await expect(readTool(client, "u", { domain: "deen", entity: "prayer" })).rejects.toThrow(DEEN_OFF_MESSAGE);
    expect(tables).not.toContain("prayers");
  });

  it("ON (positive control): the same read reaches the prayers table", async () => {
    const { client, tables } = fakeClient(true);
    await readTool(client, "u", { domain: "deen", entity: "prayer" });
    expect(tables).toContain("prayers");
  });

  it("OFF: a deen write fails BEFORE any DB call beyond the profile check", async () => {
    const { client, tables } = fakeClient(false);
    await expect(
      writeTool(client, "u", { domain: "deen", entity: "prayer", action: "log", patch: { prayer_name: "fajr", status: "on_time" } }),
    ).rejects.toThrow(DEEN_OFF_MESSAGE);
    expect(tables.filter((t) => t !== "profiles")).toEqual([]);
  });

  it("OFF: non-deen domains are unaffected (no profile gate query)", async () => {
    const { client, tables } = fakeClient(false);
    await readTool(client, "u", { domain: "fitness", entity: "workout_session" }).catch(() => {});
    expect(tables).not.toContain("profiles");
  });

  it("OFF: settings.profile read drops the prayer-only columns; ON keeps them", async () => {
    const select = (c: SupabaseClient) => (c as unknown as { from: ReturnType<typeof vi.fn> }).from;
    const off = fakeClient(false);
    await readTool(off.client, "u", { domain: "settings", entity: "profile", detail: "full" });
    const offSelects = select(off.client).mock.results.map((r) => r.value.select.mock.calls.flat()).flat().join(" ");
    expect(offSelects).not.toMatch(/location_lat|prayer_calc_method|asr_madhab|qada_owed/);
    expect(offSelects).toMatch(/display_name/);

    const on = fakeClient(true);
    await readTool(on.client, "u", { domain: "settings", entity: "profile", detail: "full" });
    const onSelects = select(on.client).mock.results.map((r) => r.value.select.mock.calls.flat()).flat().join(" ");
    expect(onSelects).toMatch(/location_lat/);
    expect(onSelects).toMatch(/prayer_calc_method/);
  });
});

describe("discovery", () => {
  it("OFF: list_capabilities(deen) is refused; ON works", async () => {
    const off = fakeClient(false);
    await expect(listCapabilitiesTool("deen", { userClient: off.client, userId: "u", now: NOW })).rejects.toThrow(DEEN_OFF_MESSAGE);
    const on = fakeClient(true);
    await expect(listCapabilitiesTool("deen", { userClient: on.client, userId: "u", now: NOW })).resolves.toBeTruthy();
  });

  it("OFF: the account map omits the deen domain and the faith area; ON includes both", async () => {
    const off = await buildAccountMap(fakeClient(false).client, "u", NOW);
    expect(off.domains.deen).toBeUndefined();
    expect(off.active_areas).not.toContain("faith");
    expect(Object.keys(off.vocabulary_map)).not.toContain("faith");
    expect(JSON.stringify(off)).not.toMatch(/Prayer|Qur'an|faith/i);

    const on = await buildAccountMap(fakeClient(true).client, "u", NOW);
    expect(on.domains.deen).toBeDefined();
    expect(on.active_areas).toContain("faith");
    expect(Object.keys(on.vocabulary_map)).toContain("faith");
  });
});

describe("widgets and scheduler", () => {
  it("OFF: creating a widget over the deen domain is refused before any widget write", async () => {
    const { client, tables } = fakeClient(false);
    await expect(
      widgetManageTool(client, "u", { action: "create", patch: { kind: "metric_card", title: "t", data_source: { domain: "deen", entity: "prayer" }, display: {} } }),
    ).rejects.toThrow(DEEN_OFF_MESSAGE);
    expect(tables.filter((t) => t !== "profiles")).toEqual([]);
  });

  it("OFF: scheduling a write at the deen domain is refused", async () => {
    const { client, tables } = fakeClient(false);
    await expect(
      schedulerManageTool(client, "u", null, { action: "create", patch: { tool_name: "write", domain: "deen", entity: "prayer", action: "log" } }),
    ).rejects.toThrow(DEEN_OFF_MESSAGE);
    expect(tables.filter((t) => t !== "profiles")).toEqual([]);
  });
});

describe("deen_mode is never agent-writable", () => {
  it("no write-registry action patchShape mentions deen_mode", async () => {
    const { WRITE_REGISTRY } = await import("../write-registry");
    const shapes = Object.values(WRITE_REGISTRY).flatMap((d) => Object.values(d.entities).flatMap((e) => Object.values(e.actions).map((a) => a.patchShape)));
    expect(shapes.join("\n")).not.toMatch(/deen_mode/);
  });
});
