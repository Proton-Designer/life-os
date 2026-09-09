import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listWidgetsCore, getWidgetCore, createWidgetCore, updateWidgetCore, archiveWidgetCore, deleteWidgetCore } from "../actions-core";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "update", "insert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

const METRIC_ROW = {
  id: "w1",
  kind: "metric_card",
  title: "Prayers today",
  data_source: { domain: "deen", entity: "prayer" },
  display: { aggregate: "count" },
  slot: "home",
  position: 0,
  status: "active",
  updated_at: "2026-09-08T12:00:00Z",
};

const LIST_ROW = {
  id: "w2",
  kind: "list",
  title: "Kill list",
  data_source: { domain: "business", entity: "kill_list_item" },
  display: { titleField: "name" },
  slot: "home",
  position: 1,
  status: "active",
  updated_at: "2026-09-08T12:00:00Z",
};

describe("listWidgetsCore", () => {
  it("returns rows narrowed to a real discriminated union keyed by kind", async () => {
    const chain = makeChain({ data: [METRIC_ROW, LIST_ROW], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const rows = await listWidgetsCore(client, "user-1");

    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe("metric_card");
    if (rows[0].kind === "metric_card") {
      // Compiles (and passes) only because WidgetRow is a real discriminated
      // union -- `display.aggregate` doesn't exist on ListDisplay, so this
      // line would be a type error if `display` were still typed as the
      // general `WidgetDisplay` union.
      expect(rows[0].display.aggregate).toBe("count");
    }
    expect(rows[1].kind).toBe("list");
    if (rows[1].kind === "list") {
      expect(rows[1].display.titleField).toBe("name");
    }
  });

  it("filters to status='active' by default — archived (MCP-'deleted') widgets are hidden", async () => {
    const chain = makeChain({ data: [], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await listWidgetsCore(client, "user-1");

    expect(chain.eq).toHaveBeenCalledWith("status", "active");
  });

  it("does NOT filter by status when includeArchived is true", async () => {
    const chain = makeChain({ data: [], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await listWidgetsCore(client, "user-1", undefined, { includeArchived: true });

    const statusCalls = (chain.eq as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === "status");
    expect(statusCalls).toHaveLength(0);
  });

  it("falls back to a safe display shape for a row whose stored display doesn't match its kind (only reachable via direct DB tampering)", async () => {
    const corrupt = { ...METRIC_ROW, display: { titleField: "not-a-metric-shape" } };
    const chain = makeChain({ data: [corrupt], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const rows = await listWidgetsCore(client, "user-1");
    expect(rows[0].kind).toBe("metric_card");
    if (rows[0].kind === "metric_card") expect(rows[0].display).toEqual({ aggregate: "count" });
  });

  it("throws (does not silently swallow) an unrecognized stored kind — a schema/registry drift is a loud failure, not a mis-render", async () => {
    const corrupt = { ...METRIC_ROW, kind: "pie_chart" };
    const chain = makeChain({ data: [corrupt], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await expect(listWidgetsCore(client, "user-1")).rejects.toThrow(/kind must be one of/);
  });
});

describe("getWidgetCore", () => {
  it("returns null when no row matches (id/user_id both scoped)", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const row = await getWidgetCore(client, "user-1", "missing");
    expect(row).toBeNull();
    expect(chain.eq).toHaveBeenCalledWith("id", "missing");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns the widget narrowed by kind when found", async () => {
    const chain = makeChain({ data: METRIC_ROW, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const row = await getWidgetCore(client, "user-1", "w1");
    expect(row?.kind).toBe("metric_card");
  });
});

describe("createWidgetCore", () => {
  it("computes position as max(existing for this slot)+1 when omitted", async () => {
    const chain = makeChain({ data: { position: 2 }, error: null });
    chain.insert = vi.fn(() => makeChain({ data: { id: "new-id" }, error: null }));
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const id = await createWidgetCore(client, "user-1", {
      kind: "metric_card",
      title: "T",
      dataSource: { domain: "deen", entity: "prayer" },
      display: { aggregate: "count" },
      slot: "home",
    });

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1", position: 3 }));
    expect(id).toBe("new-id");
  });

  it("starts position at 0 when the user has no existing widgets in this slot", async () => {
    const chain = makeChain({ data: null, error: null });
    chain.insert = vi.fn(() => makeChain({ data: { id: "new-id" }, error: null }));
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await createWidgetCore(client, "user-1", {
      kind: "list",
      title: "T",
      dataSource: { domain: "deen", entity: "prayer" },
      display: { titleField: "status" },
      slot: "home",
    });

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ position: 0 }));
  });
});

describe("updateWidgetCore", () => {
  it("no-ops (no query) when the patch is empty", async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient;
    await updateWidgetCore(client, "user-1", "w1", {});
    expect(from).not.toHaveBeenCalled();
  });

  it("scopes the update to id AND user_id", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await updateWidgetCore(client, "user-1", "w1", { title: "New title" });
    expect(chain.update).toHaveBeenCalledWith({ title: "New title" });
    expect(chain.eq).toHaveBeenCalledWith("id", "w1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});

describe("delete is two different operations depending on the actor", () => {
  it("archiveWidgetCore (MCP delete) is an UPDATE to status='archived', never a DELETE", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await archiveWidgetCore(client, "user-1", "w1");

    expect(chain.update).toHaveBeenCalledWith({ status: "archived" });
    expect(chain.delete).not.toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("id", "w1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("deleteWidgetCore (the in-app remove button's Server Action) is a REAL DELETE", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await deleteWidgetCore(client, "user-1", "w1");

    expect(chain.delete).toHaveBeenCalled();
    expect(chain.update).not.toHaveBeenCalled();
  });
});
