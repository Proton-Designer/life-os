import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderWidgets } from "../render";

/**
 * Stubs `readTool` (not the Supabase client) — `render.ts`'s entire point
 * is that it calls the real dispatcher, so these tests assert on the
 * ARGUMENTS it's called with (proving a widget's data_source really does
 * reach `readTool` unmodified) and stub its return value, rather than
 * re-mocking Supabase query chains `readTool`'s own tests already cover.
 */
const readToolMock = vi.fn();
vi.mock("@/lib/mcp/tools/read", () => ({ readTool: (...args: unknown[]) => readToolMock(...args) }));

function outcomeFor(items: Record<string, unknown>[], hasMore = false) {
  return { result: { content: [{ type: "text", text: "" }], structuredContent: { items, has_more: hasMore } }, summary: "" };
}

function makeListWidgetsClient(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null });
  return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
}

describe("renderWidgets", () => {
  it("degrades to [] rather than throwing when mcp_widgets doesn't exist yet (pre-migration)", async () => {
    const client = { from: vi.fn(() => { throw new Error("relation \"mcp_widgets\" does not exist"); }) } as unknown as SupabaseClient;
    const result = await renderWidgets(client, "user-1", "home");
    expect(result).toEqual([]);
  });

  it("a metric_card with aggregate:'count' reports the item count, and '+' when the read says has_more", async () => {
    readToolMock.mockResolvedValueOnce(outcomeFor([{ id: "1" }, { id: "2" }, { id: "3" }], true));
    const client = makeListWidgetsClient([
      { id: "w1", kind: "metric_card", title: "Tasks due", data_source: { domain: "school", entity: "task" }, display: { aggregate: "count" }, slot: "home", position: 0, status: "active", updated_at: "2026-09-09T00:00:00Z" },
    ]);

    const [rendered] = await renderWidgets(client, "user-1", "home");

    expect(readToolMock).toHaveBeenCalledWith(client, "user-1", { domain: "school", entity: "task", filter: undefined, detail: "full" });
    expect(rendered).toEqual({ id: "w1", kind: "metric_card", title: "Tasks due", value: "3+" });
  });

  it("a metric_card with aggregate:'count' and no has_more reports the exact count, no '+'", async () => {
    readToolMock.mockResolvedValueOnce(outcomeFor([{ id: "1" }], false));
    const client = makeListWidgetsClient([
      { id: "w1", kind: "metric_card", title: "Tasks due", data_source: { domain: "school", entity: "task" }, display: { aggregate: "count" }, slot: "home", position: 0, status: "active", updated_at: "x" },
    ]);

    const [rendered] = await renderWidgets(client, "user-1", "home");
    expect(rendered).toEqual({ id: "w1", kind: "metric_card", title: "Tasks due", value: "1" });
  });

  it("a metric_card with aggregate:'field' reports the first item's field, or '—' when empty/missing", async () => {
    readToolMock.mockResolvedValueOnce(outcomeFor([{ weight_lb: 181 }]));
    const client = makeListWidgetsClient([
      { id: "w1", kind: "metric_card", title: "Weight", data_source: { domain: "fitness", entity: "body_metric" }, display: { aggregate: "field", field: "weight_lb" }, slot: "home", position: 0, status: "active", updated_at: "x" },
    ]);
    const [rendered] = await renderWidgets(client, "user-1", "home");
    expect(rendered).toMatchObject({ value: "181" });

    readToolMock.mockResolvedValueOnce(outcomeFor([]));
    const client2 = makeListWidgetsClient([
      { id: "w2", kind: "metric_card", title: "Weight", data_source: { domain: "fitness", entity: "body_metric" }, display: { aggregate: "field", field: "weight_lb" }, slot: "home", position: 0, status: "active", updated_at: "x" },
    ]);
    const [renderedEmpty] = await renderWidgets(client2, "user-1", "home");
    expect(renderedEmpty).toMatchObject({ value: "—" });
  });

  it("a list widget maps items to {title, subtitle} and respects display.limit", async () => {
    readToolMock.mockResolvedValueOnce(
      outcomeFor([
        { id: "1", title: "Midterm 2", date: "2026-10-15" },
        { id: "2", title: "Lab report", date: "2026-10-20" },
        { id: "3", title: "Quiz 4", date: "2026-10-22" },
      ]),
    );
    const client = makeListWidgetsClient([
      {
        id: "w1",
        kind: "list",
        title: "Upcoming",
        data_source: { domain: "school", entity: "class_assessment" },
        display: { titleField: "title", subtitleField: "date", limit: 2 },
        slot: "home",
        position: 0,
        status: "active",
        updated_at: "x",
      },
    ]);

    const [rendered] = await renderWidgets(client, "user-1", "home");
    expect(rendered).toEqual({
      id: "w1",
      kind: "list",
      title: "Upcoming",
      items: [
        { title: "Midterm 2", subtitle: "2026-10-15" },
        { title: "Lab report", subtitle: "2026-10-20" },
      ],
    });
  });

  it("a list widget with no subtitleField omits subtitle entirely", async () => {
    readToolMock.mockResolvedValueOnce(outcomeFor([{ id: "1", title: "Midterm 2" }]));
    const client = makeListWidgetsClient([
      { id: "w1", kind: "list", title: "Upcoming", data_source: { domain: "school", entity: "class_assessment" }, display: { titleField: "title" }, slot: "home", position: 0, status: "active", updated_at: "x" },
    ]);
    const [rendered] = await renderWidgets(client, "user-1", "home");
    expect(rendered).toMatchObject({ items: [{ title: "Midterm 2" }] });
    // Own-property-but-undefined (object literal shorthand), not absent —
    // immaterial to the component (a falsy check) and to JSON.stringify
    // (drops undefined-valued keys), but worth pinning the actual value
    // rather than just "not strictly equal to the object missing it".
    expect((rendered as { items: { subtitle?: string }[] }).items[0].subtitle).toBeUndefined();
  });

  it("a widget whose data source has gone stale renders its OWN error, and never breaks the rest of the list", async () => {
    readToolMock
      .mockRejectedValueOnce(new Error("Unknown entity \"task\" for domain \"school\""))
      .mockResolvedValueOnce(outcomeFor([{ id: "1" }]));
    const client = makeListWidgetsClient([
      { id: "w-broken", kind: "metric_card", title: "Broken", data_source: { domain: "school", entity: "task" }, display: { aggregate: "count" }, slot: "home", position: 0, status: "active", updated_at: "x" },
      { id: "w-ok", kind: "metric_card", title: "OK", data_source: { domain: "school", entity: "task" }, display: { aggregate: "count" }, slot: "home", position: 1, status: "active", updated_at: "x" },
    ]);

    const rendered = await renderWidgets(client, "user-1", "home");
    expect(rendered).toEqual([
      { id: "w-broken", kind: "metric_card", title: "Broken", error: 'Unknown entity "task" for domain "school"' },
      { id: "w-ok", kind: "metric_card", title: "OK", value: "1" },
    ]);
  });

  it("passes the widget's filter through to readTool unmodified (parentFilter-bearing entities, fixedFilter-scoped entities alike)", async () => {
    readToolMock.mockResolvedValueOnce(outcomeFor([]));
    const client = makeListWidgetsClient([
      {
        id: "w1",
        kind: "list",
        title: "Overrides",
        data_source: { domain: "school", entity: "schedule_event_override", filter: { event_id: "event-1" } },
        display: { titleField: "date" },
        slot: "home",
        position: 0,
        status: "active",
        updated_at: "x",
      },
    ]);
    await renderWidgets(client, "user-1", "home");
    expect(readToolMock).toHaveBeenCalledWith(client, "user-1", { domain: "school", entity: "schedule_event_override", filter: { event_id: "event-1" }, detail: "full" });
  });

  // R11's first extended-vocabulary kind.
  describe("progress_against_goal", () => {
    it("a count aggregate reports current/goal/percent, clamped at 100", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([{ id: "1" }, { id: "2" }, { id: "3" }], false));
      const client = makeListWidgetsClient([
        { id: "w1", kind: "progress_against_goal", title: "Tasks done", data_source: { domain: "school", entity: "task" }, display: { aggregate: { type: "count" }, goal: 2 }, slot: "home", position: 0, status: "active", updated_at: "x" },
      ]);
      const [rendered] = await renderWidgets(client, "user-1", "home");
      // goal 2, current 3 -- over-goal clamps the PERCENT to 100, but current
      // itself still reports the real count, never clamped.
      expect(rendered).toEqual({ id: "w1", kind: "progress_against_goal", title: "Tasks done", current: 3, hasMore: false, goal: 2, percent: 100 });
    });

    it("a sum aggregate derives the total from the rows readTool already returned -- never a second query", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([{ pages_read: 10 }, { pages_read: 15 }], false));
      const client = makeListWidgetsClient([
        { id: "w1", kind: "progress_against_goal", title: "Pages read", data_source: { domain: "deen", entity: "quran_session" }, display: { aggregate: { type: "sum", field: "pages_read" }, goal: 50 }, slot: "home", position: 0, status: "active", updated_at: "x" },
      ]);
      const [rendered] = await renderWidgets(client, "user-1", "home");
      expect(rendered).toEqual({ id: "w1", kind: "progress_against_goal", title: "Pages read", current: 25, hasMore: false, goal: 50, percent: 50 });
    });

    it("a sum aggregate skips non-numeric/missing values rather than letting one bad row zero out the rest", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([{ pages_read: 10 }, { pages_read: null }, { pages_read: "not a number" }, {}], false));
      const client = makeListWidgetsClient([
        { id: "w1", kind: "progress_against_goal", title: "Pages read", data_source: { domain: "deen", entity: "quran_session" }, display: { aggregate: { type: "sum", field: "pages_read" }, goal: 50 }, slot: "home", position: 0, status: "active", updated_at: "x" },
      ]);
      const [rendered] = await renderWidgets(client, "user-1", "home");
      expect(rendered).toMatchObject({ current: 10 });
    });

    it("reports hasMore honestly when readTool's own page cap means the sum/count is a floor, not exact -- the same honesty convention as metric_card's count", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([{ id: "1" }, { id: "2" }], true));
      const client = makeListWidgetsClient([
        { id: "w1", kind: "progress_against_goal", title: "Tasks done", data_source: { domain: "school", entity: "task" }, display: { aggregate: { type: "count" }, goal: 100 }, slot: "home", position: 0, status: "active", updated_at: "x" },
      ]);
      const [rendered] = await renderWidgets(client, "user-1", "home");
      expect(rendered).toMatchObject({ current: 2, hasMore: true });
    });

    it("a widget whose data source has gone stale renders its OWN error, same isolation as the other kinds", async () => {
      readToolMock.mockRejectedValueOnce(new Error("Unknown entity \"task\" for domain \"school\""));
      const client = makeListWidgetsClient([
        { id: "w1", kind: "progress_against_goal", title: "Broken", data_source: { domain: "school", entity: "task" }, display: { aggregate: { type: "count" }, goal: 10 }, slot: "home", position: 0, status: "active", updated_at: "x" },
      ]);
      const [rendered] = await renderWidgets(client, "user-1", "home");
      expect(rendered).toEqual({ id: "w1", kind: "progress_against_goal", title: "Broken", error: 'Unknown entity "task" for domain "school"' });
    });
  });
});
