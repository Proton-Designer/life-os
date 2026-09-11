import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { widgetManageTool, resolveWidgetManageOperation, resolveWidgetManageScope } from "../widget-manage";

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

function textOf(outcome: Awaited<ReturnType<typeof widgetManageTool>>): string {
  const block = outcome.result.content[0];
  if (block.type !== "text") throw new Error("expected text");
  return block.text;
}

const EXISTING_METRIC_ROW = {
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

describe("resolveWidgetManageScope / resolveWidgetManageOperation", () => {
  it("scopes 'list' as read-only, every mutation as write", () => {
    expect(resolveWidgetManageScope("list")).toBe("read");
    expect(resolveWidgetManageScope("create")).toBe("write");
    expect(resolveWidgetManageScope("update")).toBe("write");
    expect(resolveWidgetManageScope("delete")).toBe("write");
  });

  it("names the resolved operation widget_manage.<action>", () => {
    expect(resolveWidgetManageOperation({ action: "create" })).toBe("widget_manage.create");
  });
});

describe("widgetManageTool — create", () => {
  it("creates a widget against a valid data source", async () => {
    const chain = makeChain({ data: null, error: null });
    chain.insert = vi.fn(() => makeChain({ data: { id: "new-id" }, error: null }));
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const outcome = await widgetManageTool(client, "user-1", {
      action: "create",
      patch: { kind: "metric_card", title: "Prayers today", data_source: { domain: "deen", entity: "prayer" }, display: { aggregate: "count" } },
    });

    expect(JSON.parse(textOf(outcome))).toEqual({ id: "new-id" });
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "metric_card", title: "Prayers today" }));
  });

  it("creates a progress_against_goal widget (R11's first extended-vocabulary kind) end-to-end", async () => {
    const chain = makeChain({ data: null, error: null });
    chain.insert = vi.fn(() => makeChain({ data: { id: "new-id" }, error: null }));
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const outcome = await widgetManageTool(client, "user-1", {
      action: "create",
      patch: {
        kind: "progress_against_goal",
        title: "Pages read this week",
        data_source: { domain: "deen", entity: "quran_session" },
        display: { aggregate: { type: "sum", field: "pages_read" }, goal: 50 },
      },
    });

    expect(JSON.parse(textOf(outcome))).toEqual({ id: "new-id" });
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "progress_against_goal", display: { aggregate: { type: "sum", field: "pages_read" }, goal: 50 } }),
    );
  });

  it("creates a sparkline widget (R12's first kind) end-to-end, dateField validated against the entity's own descending orderBy", async () => {
    const chain = makeChain({ data: null, error: null });
    chain.insert = vi.fn(() => makeChain({ data: { id: "new-id" }, error: null }));
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const outcome = await widgetManageTool(client, "user-1", {
      action: "create",
      patch: {
        kind: "sparkline",
        title: "Pages read trend",
        data_source: { domain: "deen", entity: "quran_session" },
        display: { dateField: "date", valueField: "pages_read", days: 30 },
      },
    });

    expect(JSON.parse(textOf(outcome))).toEqual({ id: "new-id" });
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "sparkline", display: { dateField: "date", valueField: "pages_read", days: 30 } }),
    );
  });

  it("REFUSES a sparkline whose dateField isn't the data source's own primary descending sort column", async () => {
    const client = { from: vi.fn(() => makeChain()) } as unknown as SupabaseClient;
    await expect(
      widgetManageTool(client, "user-1", {
        action: "create",
        patch: { kind: "sparkline", title: "Tasks trend", data_source: { domain: "school", entity: "task" }, display: { dateField: "due_date" } },
      }),
    ).rejects.toThrow(/primary sort column, descending/i);
  });

  // The structural guarantee the lead asked to be proven at the tool
  // level, not just inside validate.ts's own unit tests: a widget cannot
  // be created against a column the visibility registry excludes.
  it("REFUSES a widget whose display points at source_chunks.text (raw book text, deliberately unreachable over MCP) — never reaches insert", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await expect(
      widgetManageTool(client, "user-1", {
        action: "create",
        patch: {
          kind: "metric_card",
          title: "Book text",
          data_source: { domain: "self_mastery", entity: "source_chunks" },
          display: { aggregate: "field", field: "text" },
        },
      }),
    ).rejects.toThrow(/not a column on this widget's data source/i);

    expect(chain.insert).not.toHaveBeenCalled();
  });

  it("REFUSES a widget whose display points at user_api_keys.encrypted_key the same way", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await expect(
      widgetManageTool(client, "user-1", {
        action: "create",
        patch: {
          kind: "metric_card",
          title: "Key",
          data_source: { domain: "settings", entity: "api_key" },
          display: { aggregate: "field", field: "encrypted_key" },
        },
      }),
    ).rejects.toThrow(/not a column/i);

    expect(chain.insert).not.toHaveBeenCalled();
  });
});

describe("widgetManageTool — update", () => {
  it("validates display against the widget's OWN stored kind, never a client-supplied one — and re-derives fullColumns from the existing data_source when none is resent", async () => {
    const chain = makeChain({ data: EXISTING_METRIC_ROW, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const outcome = await widgetManageTool(client, "user-1", {
      action: "update",
      id: "w1",
      patch: { display: { aggregate: "count" } },
    });

    expect(JSON.parse(textOf(outcome))).toEqual({ id: "w1" });
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ display: { aggregate: "count" } }));
  });

  it("rejects a display shape that isn't valid for the widget's real kind (metric_card here) even though nothing in the patch claims a kind at all", async () => {
    const chain = makeChain({ data: EXISTING_METRIC_ROW, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    // A "list"-shaped display (titleField) has no meaning for a metric_card
    // widget -- validateDisplay("metric_card", ...) must reject it using
    // the ROW's kind, since update's patch never carries kind at all.
    await expect(
      widgetManageTool(client, "user-1", { action: "update", id: "w1", patch: { display: { titleField: "status" } } }),
    ).rejects.toThrow(/must be 'count' or 'field'/);
  });

  it("errors clearly when the widget doesn't exist (or isn't this user's)", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await expect(widgetManageTool(client, "user-1", { action: "update", id: "missing", patch: { title: "x" } })).rejects.toThrow(/no widget with id/i);
  });

  it("requires an id", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await expect(widgetManageTool(client, "user-1", { action: "update", patch: { title: "x" } })).rejects.toThrow(/requires the top-level `id`/);
  });
});

describe("widgetManageTool — delete is an archive, never a DELETE", () => {
  it("flips status to 'archived' via UPDATE, and never calls .delete()", async () => {
    const chain = makeChain({ data: EXISTING_METRIC_ROW, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const outcome = await widgetManageTool(client, "user-1", { action: "delete", id: "w1" });

    expect(JSON.parse(textOf(outcome))).toEqual({ id: "w1" });
    expect(chain.update).toHaveBeenCalledWith({ status: "archived" });
    expect(chain.delete).not.toHaveBeenCalled();
  });

  it("errors clearly when the widget doesn't exist (or isn't this user's)", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await expect(widgetManageTool(client, "user-1", { action: "delete", id: "missing" })).rejects.toThrow(/no widget with id/i);
  });
});

describe("widgetManageTool — list", () => {
  it("hides archived widgets by default", async () => {
    const chain = makeChain({ data: [], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await widgetManageTool(client, "user-1", { action: "list" });

    expect(chain.eq).toHaveBeenCalledWith("status", "active");
  });

  it("includes archived widgets when patch.include_archived is true", async () => {
    const chain = makeChain({ data: [], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await widgetManageTool(client, "user-1", { action: "list", patch: { include_archived: true } });

    const statusCalls = (chain.eq as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === "status");
    expect(statusCalls).toHaveLength(0);
  });
});
