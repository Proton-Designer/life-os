import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderWidgets } from "../render";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const TIMEZONE = "America/Chicago";

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
    const result = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
    expect(result).toEqual([]);
  });

  it("a metric_card with aggregate:'count' reports the item count, and '+' when the read says has_more", async () => {
    readToolMock.mockResolvedValueOnce(outcomeFor([{ id: "1" }, { id: "2" }, { id: "3" }], true));
    const client = makeListWidgetsClient([
      { id: "w1", kind: "metric_card", title: "Tasks due", data_source: { domain: "school", entity: "task" }, display: { aggregate: "count" }, slot: "home", position: 0, status: "active", updated_at: "2026-09-09T00:00:00Z" },
    ]);

    const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);

    expect(readToolMock).toHaveBeenCalledWith(client, "user-1", { domain: "school", entity: "task", filter: undefined, detail: "full" });
    expect(rendered).toEqual({ id: "w1", kind: "metric_card", title: "Tasks due", value: "3+" });
  });

  it("a metric_card with aggregate:'count' and no has_more reports the exact count, no '+'", async () => {
    readToolMock.mockResolvedValueOnce(outcomeFor([{ id: "1" }], false));
    const client = makeListWidgetsClient([
      { id: "w1", kind: "metric_card", title: "Tasks due", data_source: { domain: "school", entity: "task" }, display: { aggregate: "count" }, slot: "home", position: 0, status: "active", updated_at: "x" },
    ]);

    const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
    expect(rendered).toEqual({ id: "w1", kind: "metric_card", title: "Tasks due", value: "1" });
  });

  it("a metric_card with aggregate:'field' reports the first item's field, or '—' when empty/missing", async () => {
    readToolMock.mockResolvedValueOnce(outcomeFor([{ weight_lb: 181 }]));
    const client = makeListWidgetsClient([
      { id: "w1", kind: "metric_card", title: "Weight", data_source: { domain: "fitness", entity: "body_metric" }, display: { aggregate: "field", field: "weight_lb" }, slot: "home", position: 0, status: "active", updated_at: "x" },
    ]);
    const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
    expect(rendered).toMatchObject({ value: "181" });

    readToolMock.mockResolvedValueOnce(outcomeFor([]));
    const client2 = makeListWidgetsClient([
      { id: "w2", kind: "metric_card", title: "Weight", data_source: { domain: "fitness", entity: "body_metric" }, display: { aggregate: "field", field: "weight_lb" }, slot: "home", position: 0, status: "active", updated_at: "x" },
    ]);
    const [renderedEmpty] = await renderWidgets(client2, "user-1", "home", NOW, TIMEZONE);
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

    const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
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
    const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
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

    const rendered = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
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
    await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
    expect(readToolMock).toHaveBeenCalledWith(client, "user-1", { domain: "school", entity: "schedule_event_override", filter: { event_id: "event-1" }, detail: "full" });
  });

  // R11's first extended-vocabulary kind.
  describe("progress_against_goal", () => {
    it("a count aggregate reports current/goal/percent, clamped at 100", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([{ id: "1" }, { id: "2" }, { id: "3" }], false));
      const client = makeListWidgetsClient([
        { id: "w1", kind: "progress_against_goal", title: "Tasks done", data_source: { domain: "school", entity: "task" }, display: { aggregate: { type: "count" }, goal: 2 }, slot: "home", position: 0, status: "active", updated_at: "x" },
      ]);
      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      // goal 2, current 3 -- over-goal clamps the PERCENT to 100, but current
      // itself still reports the real count, never clamped.
      expect(rendered).toEqual({ id: "w1", kind: "progress_against_goal", title: "Tasks done", current: 3, hasMore: false, goal: 2, percent: 100 });
    });

    it("a sum aggregate derives the total from the rows readTool already returned -- never a second query", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([{ pages_read: 10 }, { pages_read: 15 }], false));
      const client = makeListWidgetsClient([
        { id: "w1", kind: "progress_against_goal", title: "Pages read", data_source: { domain: "deen", entity: "quran_session" }, display: { aggregate: { type: "sum", field: "pages_read" }, goal: 50 }, slot: "home", position: 0, status: "active", updated_at: "x" },
      ]);
      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      expect(rendered).toEqual({ id: "w1", kind: "progress_against_goal", title: "Pages read", current: 25, hasMore: false, goal: 50, percent: 50 });
    });

    it("a sum aggregate skips non-numeric/missing values rather than letting one bad row zero out the rest", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([{ pages_read: 10 }, { pages_read: null }, { pages_read: "not a number" }, {}], false));
      const client = makeListWidgetsClient([
        { id: "w1", kind: "progress_against_goal", title: "Pages read", data_source: { domain: "deen", entity: "quran_session" }, display: { aggregate: { type: "sum", field: "pages_read" }, goal: 50 }, slot: "home", position: 0, status: "active", updated_at: "x" },
      ]);
      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      expect(rendered).toMatchObject({ current: 10 });
    });

    it("reports hasMore honestly when readTool's own page cap means the sum/count is a floor, not exact -- the same honesty convention as metric_card's count", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([{ id: "1" }, { id: "2" }], true));
      const client = makeListWidgetsClient([
        { id: "w1", kind: "progress_against_goal", title: "Tasks done", data_source: { domain: "school", entity: "task" }, display: { aggregate: { type: "count" }, goal: 100 }, slot: "home", position: 0, status: "active", updated_at: "x" },
      ]);
      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      expect(rendered).toMatchObject({ current: 2, hasMore: true });
    });

    it("a widget whose data source has gone stale renders its OWN error, same isolation as the other kinds", async () => {
      readToolMock.mockRejectedValueOnce(new Error("Unknown entity \"task\" for domain \"school\""));
      const client = makeListWidgetsClient([
        { id: "w1", kind: "progress_against_goal", title: "Broken", data_source: { domain: "school", entity: "task" }, display: { aggregate: { type: "count" }, goal: 10 }, slot: "home", position: 0, status: "active", updated_at: "x" },
      ]);
      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      expect(rendered).toEqual({ id: "w1", kind: "progress_against_goal", title: "Broken", error: 'Unknown entity "task" for domain "school"' });
    });
  });

  // R12's first kind -- the one the raised row limit exists to unblock.
  describe("sparkline", () => {
    beforeEach(() => {
      // This describe block's own tests assert on CALL COUNT
      // (toHaveBeenCalledTimes), unlike every test above this point, which
      // only asserts "was it ever called with X" -- accumulation-safe even
      // though readToolMock is never cleared at the top of this file. A
      // count-based assertion is NOT accumulation-safe, so this block gets
      // its own reset, scoped to itself by vitest's nesting rules.
      readToolMock.mockClear();
    });

    function sparklineWidget(overrides: Record<string, unknown> = {}) {
      return [
        {
          id: "w1",
          kind: "sparkline",
          title: "Pages read trend",
          data_source: { domain: "deen", entity: "quran_session" },
          display: { dateField: "date", days: 7 },
          slot: "home",
          position: 0,
          status: "active",
          updated_at: "x",
          ...overrides,
        },
      ];
    }

    it("POSITIVE CONTROL: toHaveBeenCalledTimes(1) actually fails when readTool is called twice -- proven before trusting it to report once below", async () => {
      readToolMock();
      readToolMock();
      expect(() => expect(readToolMock).toHaveBeenCalledTimes(1)).toThrow();
      readToolMock.mockClear();
    });

    it("calls readTool exactly once per widget, with options.maxRows -- never a second query for the derived series", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([]));
      const client = makeListWidgetsClient(sparklineWidget());

      await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);

      expect(readToolMock).toHaveBeenCalledTimes(1);
      expect(readToolMock).toHaveBeenCalledWith(
        client,
        "user-1",
        { domain: "deen", entity: "quran_session", filter: undefined, detail: "full" },
        { maxRows: 100 },
      );
    });

    it("non-sparkline kinds still call readTool with exactly 3 arguments -- the raised limit never leaks to them", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([]));
      const client = makeListWidgetsClient([
        { id: "w1", kind: "metric_card", title: "Tasks due", data_source: { domain: "school", entity: "task" }, display: { aggregate: "count" }, slot: "home", position: 0, status: "active", updated_at: "x" },
      ]);
      await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      expect(readToolMock).toHaveBeenCalledWith(client, "user-1", { domain: "school", entity: "task", filter: undefined, detail: "full" });
      expect(readToolMock.mock.calls[0]).toHaveLength(3);
    });

    it("buckets rows by local calendar day (count aggregate), zero-filling days with no matching rows", async () => {
      const today = "2026-09-09";
      readToolMock.mockResolvedValueOnce(
        outcomeFor([{ id: "1", date: today }, { id: "2", date: today }, { id: "3", date: "2026-09-08" }]),
      );
      const client = makeListWidgetsClient(sparklineWidget());

      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      if ("error" in rendered) throw new Error(`unexpected error: ${rendered.error}`);
      if (rendered.kind !== "sparkline") throw new Error("expected sparkline");
      expect(rendered.points).toHaveLength(7);
      expect(rendered.points.at(-1)).toEqual({ date: "2026-09-09", value: 2 });
      expect(rendered.points.at(-2)).toEqual({ date: "2026-09-08", value: 1 });
      expect(rendered.points[0]).toEqual({ date: "2026-09-03", value: 0 }); // 6 days before today, zero-filled
    });

    it("sums valueField per day, and a date-only OR out-of-window row is handled correctly (skipped if outside the window, never shifted into it)", async () => {
      readToolMock.mockResolvedValueOnce(
        outcomeFor([
          { date: "2026-09-09", pages_read: 10 },
          { date: "2026-09-09", pages_read: 5 },
          { date: "2026-01-01", pages_read: 999 }, // outside the 7-day window -- must be ignored, not bucketed into day 0
        ]),
      );
      const client = makeListWidgetsClient(sparklineWidget({ display: { dateField: "date", valueField: "pages_read", days: 7 } }));

      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      if ("error" in rendered) throw new Error(`unexpected error: ${rendered.error}`);
      if (rendered.kind !== "sparkline") throw new Error("expected sparkline");
      expect(rendered.points.at(-1)).toEqual({ date: "2026-09-09", value: 15 });
      expect(rendered.points.reduce((sum, p) => sum + p.value, 0)).toBe(15); // the out-of-window row contributed nothing
    });

    it("skips non-numeric/missing valueField values rather than letting one bad row zero out the day", async () => {
      readToolMock.mockResolvedValueOnce(
        outcomeFor([{ date: "2026-09-09", pages_read: 10 }, { date: "2026-09-09", pages_read: null }, { date: "2026-09-09", pages_read: "oops" }]),
      );
      const client = makeListWidgetsClient(sparklineWidget({ display: { dateField: "date", valueField: "pages_read", days: 7 } }));
      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      if ("error" in rendered) throw new Error(`unexpected error: ${rendered.error}`);
      if (rendered.kind !== "sparkline") throw new Error("expected sparkline");
      expect(rendered.points.at(-1)).toEqual({ date: "2026-09-09", value: 10 });
    });

    it("propagates hasMore honestly -- the chart still renders, the caller can flag the window as a possible floor", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([{ date: "2026-09-09" }], true));
      const client = makeListWidgetsClient(sparklineWidget());
      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      if ("error" in rendered) throw new Error(`unexpected error: ${rendered.error}`);
      if (rendered.kind !== "sparkline") throw new Error("expected sparkline");
      expect(rendered.hasMore).toBe(true);
    });

    it("a sparkline whose data source has gone stale renders its OWN error, same isolation as every other kind", async () => {
      readToolMock.mockRejectedValueOnce(new Error("Unknown entity \"quran_session\" for domain \"deen\""));
      const client = makeListWidgetsClient(sparklineWidget());
      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      expect(rendered).toEqual({ id: "w1", kind: "sparkline", title: "Pages read trend", error: 'Unknown entity "quran_session" for domain "deen"' });
    });

    // AGENTS.md's rule, pinned at the boundary, not just the happy path:
    // the same local instant either side of the UTC rollover must bucket
    // identically, and a zone EAST of UTC (where the bug inverts) must be
    // covered too -- not just America/Chicago, which is west.
    describe("UTC rollover boundary — a TIMESTAMP dateField value, never a date-only string", () => {
      it("18:59 and 19:01 America/Chicago (either side of the UTC day-rollover) both bucket into the SAME local day", async () => {
        // 18:59 CDT on 2026-09-08 == 2026-09-08T23:59:00Z -- still Sept 8 in both UTC and local.
        readToolMock.mockResolvedValueOnce(outcomeFor([{ ts: "2026-09-08T23:59:00.000Z" }]));
        const client1 = makeListWidgetsClient(sparklineWidget({ display: { dateField: "ts", days: 7 } }));
        const [before] = await renderWidgets(client1, "user-1", "home", new Date("2026-09-09T12:00:00.000Z"), "America/Chicago");
        if ("error" in before) throw new Error(`unexpected error: ${before.error}`);
        if (before.kind !== "sparkline") throw new Error("expected sparkline");
        expect(before.points.find((p) => p.value === 1)?.date).toBe("2026-09-08");

        // 19:01 CDT on 2026-09-08 == 2026-09-09T00:01:00Z -- already "tomorrow" in UTC,
        // but still the evening of Sept 8 locally. A `.toISOString().slice(0,10)`-style
        // bug would read this as "2026-09-09" -- the exact inverse-of-correct answer.
        readToolMock.mockResolvedValueOnce(outcomeFor([{ ts: "2026-09-09T00:01:00.000Z" }]));
        const client2 = makeListWidgetsClient(sparklineWidget({ display: { dateField: "ts", days: 7 } }));
        const [after] = await renderWidgets(client2, "user-1", "home", new Date("2026-09-09T12:00:00.000Z"), "America/Chicago");
        if ("error" in after) throw new Error(`unexpected error: ${after.error}`);
        if (after.kind !== "sparkline") throw new Error("expected sparkline");
        expect(after.points.find((p) => p.value === 1)?.date).toBe("2026-09-08");
      });

      it("a timezone EAST of UTC (Asia/Tokyo) buckets the SAME instant into the NEXT calendar day -- the inverse of the America/Chicago case, proving this isn't hardcoded to 'always subtract'", async () => {
        // 2026-09-08T16:00:00Z is 2026-09-09 01:00 in Asia/Tokyo (UTC+9) --
        // already tomorrow locally, even though it's still "today" in UTC.
        readToolMock.mockResolvedValueOnce(outcomeFor([{ ts: "2026-09-08T16:00:00.000Z" }]));
        const client = makeListWidgetsClient(sparklineWidget({ display: { dateField: "ts", days: 7 } }));
        const [rendered] = await renderWidgets(client, "user-1", "home", new Date("2026-09-09T12:00:00.000Z"), "Asia/Tokyo");
        if ("error" in rendered) throw new Error(`unexpected error: ${rendered.error}`);
      if (rendered.kind !== "sparkline") throw new Error("expected sparkline");
        expect(rendered.points.find((p) => p.value === 1)?.date).toBe("2026-09-09");
      });

      it("a date-only value ('2026-09-08', no time component) is used AS-IS regardless of timezone -- never re-parsed through new Date(), which would risk shifting it a day in Asia/Tokyo", async () => {
        readToolMock.mockResolvedValueOnce(outcomeFor([{ ts: "2026-09-08" }]));
        const client = makeListWidgetsClient(sparklineWidget({ display: { dateField: "ts", days: 7 } }));
        const [rendered] = await renderWidgets(client, "user-1", "home", new Date("2026-09-09T12:00:00.000Z"), "Asia/Tokyo");
        if ("error" in rendered) throw new Error(`unexpected error: ${rendered.error}`);
      if (rendered.kind !== "sparkline") throw new Error("expected sparkline");
        expect(rendered.points.find((p) => p.value === 1)?.date).toBe("2026-09-08");
      });
    });
  });

  // R12's second kind -- the streak walk, same raised-limit unblock as
  // sparkline. The lead's explicit design question this kind answers: what
  // happens when the fetched window runs out before a real miss is found?
  // "100+" is honest, "100" is a lie -- same floor discipline as has_more
  // elsewhere, carried explicitly rather than left implicit.
  describe("streak", () => {
    beforeEach(() => {
      // Same accumulation hazard as the sparkline block above -- this
      // block's own tests assert on call COUNT, which is not
      // accumulation-safe against the file-level readToolMock.
      readToolMock.mockClear();
    });

    function streakWidget(overrides: Record<string, unknown> = {}) {
      return [
        {
          id: "w1",
          kind: "streak",
          title: "Quran reading streak",
          data_source: { domain: "deen", entity: "quran_session" },
          display: { dateField: "date" },
          slot: "home",
          position: 0,
          status: "active",
          updated_at: "x",
          ...overrides,
        },
      ];
    }

    it("POSITIVE CONTROL: toHaveBeenCalledTimes(1) actually fails when readTool is called twice -- proven before trusting it to report once below", async () => {
      readToolMock();
      readToolMock();
      expect(() => expect(readToolMock).toHaveBeenCalledTimes(1)).toThrow();
      readToolMock.mockClear();
    });

    it("calls readTool exactly once per widget, with options.maxRows -- same raised-limit mechanism as sparkline", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([]));
      const client = makeListWidgetsClient(streakWidget());

      await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);

      expect(readToolMock).toHaveBeenCalledTimes(1);
      expect(readToolMock).toHaveBeenCalledWith(
        client,
        "user-1",
        { domain: "deen", entity: "quran_session", filter: undefined, detail: "full" },
        { maxRows: 100 },
      );
    });

    it("an EMPTY fetch is an honest 0 -- today pending, no streak, no floor claimed", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([], false));
      const client = makeListWidgetsClient(streakWidget());
      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      if ("error" in rendered) throw new Error(`unexpected error: ${rendered.error}`);
      if (rendered.kind !== "streak") throw new Error("expected streak");
      expect(rendered).toEqual({ id: "w1", kind: "streak", title: "Quran reading streak", streak: 0, todayPending: true, hasMore: false });
    });

    // The subtle correctness case the lead's design question was really
    // about: a CONFIRMED miss (a day inside the fetched window with no hit)
    // must stop the count exactly and win over `has_more`, regardless of
    // what has_more says -- rows further back than an actual break don't
    // matter, the streak already ended. `has_more:true` is deliberately set
    // here so a bug that let has_more override a real break would flip this
    // test red.
    it("a CONFIRMED miss stops the count exactly, and wins over has_more even when has_more is true", async () => {
      readToolMock.mockResolvedValueOnce(
        outcomeFor(
          [{ date: "2026-09-09" }, { date: "2026-09-08" }, { date: "2026-09-07" }, { date: "2026-09-05" }], // gap at 2026-09-06
          true,
        ),
      );
      const client = makeListWidgetsClient(streakWidget());
      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      if ("error" in rendered) throw new Error(`unexpected error: ${rendered.error}`);
      if (rendered.kind !== "streak") throw new Error("expected streak");
      expect(rendered).toEqual({ id: "w1", kind: "streak", title: "Quran reading streak", streak: 3, todayPending: false, hasMore: false });
    });

    it("todayPending:true when today has no hit yet -- the count runs through yesterday instead of reporting a misleading 0", async () => {
      readToolMock.mockResolvedValueOnce(
        outcomeFor(
          [{ date: "2026-09-08" }, { date: "2026-09-07" }, { date: "2026-09-04" }], // gap at 2026-09-06/05, no hit on 2026-09-09 (today)
          false,
        ),
      );
      const client = makeListWidgetsClient(streakWidget());
      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      if ("error" in rendered) throw new Error(`unexpected error: ${rendered.error}`);
      if (rendered.kind !== "streak") throw new Error("expected streak");
      expect(rendered).toEqual({ id: "w1", kind: "streak", title: "Quran reading streak", streak: 2, todayPending: true, hasMore: false });
    });

    // The exhausted-window case, both sides: the walk consumes every row the
    // fetch actually returned without ever finding a miss. Whether that's an
    // exact count or a floor depends ENTIRELY on readTool's own has_more --
    // never on a guess about what lies beyond the fetch.
    it("EXHAUSTED window + has_more:true -- the true streak may run longer than the fetch could see, reported as an honest floor", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([{ date: "2026-09-09" }, { date: "2026-09-08" }, { date: "2026-09-07" }], true));
      const client = makeListWidgetsClient(streakWidget());
      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      if ("error" in rendered) throw new Error(`unexpected error: ${rendered.error}`);
      if (rendered.kind !== "streak") throw new Error("expected streak");
      expect(rendered).toEqual({ id: "w1", kind: "streak", title: "Quran reading streak", streak: 3, todayPending: false, hasMore: true });
    });

    it("EXHAUSTED window + has_more:false -- the fetch saw the entire data source, so the same count is exact, not a floor", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([{ date: "2026-09-09" }, { date: "2026-09-08" }, { date: "2026-09-07" }], false));
      const client = makeListWidgetsClient(streakWidget());
      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      if ("error" in rendered) throw new Error(`unexpected error: ${rendered.error}`);
      if (rendered.kind !== "streak") throw new Error("expected streak");
      expect(rendered).toEqual({ id: "w1", kind: "streak", title: "Quran reading streak", streak: 3, todayPending: false, hasMore: false });
    });

    it("multiple rows on the same local day collapse to one hit, not a longer streak", async () => {
      readToolMock.mockResolvedValueOnce(outcomeFor([{ date: "2026-09-09" }, { date: "2026-09-09" }, { date: "2026-09-09" }], false));
      const client = makeListWidgetsClient(streakWidget());
      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      if ("error" in rendered) throw new Error(`unexpected error: ${rendered.error}`);
      if (rendered.kind !== "streak") throw new Error("expected streak");
      expect(rendered.streak).toBe(1);
    });

    it("a streak whose data source has gone stale renders its OWN error, same isolation as every other kind", async () => {
      readToolMock.mockRejectedValueOnce(new Error("Unknown entity \"quran_session\" for domain \"deen\""));
      const client = makeListWidgetsClient(streakWidget());
      const [rendered] = await renderWidgets(client, "user-1", "home", NOW, TIMEZONE);
      expect(rendered).toEqual({ id: "w1", kind: "streak", title: "Quran reading streak", error: 'Unknown entity "quran_session" for domain "deen"' });
    });

    // AGENTS.md's rule, pinned at the boundary -- same discipline as
    // sparkline's boundary tests, applied to streak's "is today/yesterday a
    // hit" determination rather than a chart's bucketing.
    describe("UTC rollover boundary — a TIMESTAMP dateField value, never a date-only string", () => {
      it("18:59 and 19:01 America/Chicago (either side of the UTC day-rollover) both bucket into the SAME local day (yesterday, not today)", async () => {
        // 18:59 CDT on 2026-09-08 == 2026-09-08T23:59:00Z -- still Sept 8 in both UTC and local.
        readToolMock.mockResolvedValueOnce(outcomeFor([{ ts: "2026-09-08T23:59:00.000Z" }], false));
        const client1 = makeListWidgetsClient(streakWidget({ display: { dateField: "ts" } }));
        const [before] = await renderWidgets(client1, "user-1", "home", new Date("2026-09-09T12:00:00.000Z"), "America/Chicago");
        if ("error" in before) throw new Error(`unexpected error: ${before.error}`);
        if (before.kind !== "streak") throw new Error("expected streak");
        expect(before).toMatchObject({ streak: 1, todayPending: true });

        // 19:01 CDT on 2026-09-08 == 2026-09-09T00:01:00Z -- already "tomorrow" in UTC,
        // but still the evening of Sept 8 locally. A `.toISOString().slice(0,10)`-style
        // bug would read this as "2026-09-09" -- i.e. today, wrongly clearing todayPending.
        readToolMock.mockResolvedValueOnce(outcomeFor([{ ts: "2026-09-09T00:01:00.000Z" }], false));
        const client2 = makeListWidgetsClient(streakWidget({ display: { dateField: "ts" } }));
        const [after] = await renderWidgets(client2, "user-1", "home", new Date("2026-09-09T12:00:00.000Z"), "America/Chicago");
        if ("error" in after) throw new Error(`unexpected error: ${after.error}`);
        if (after.kind !== "streak") throw new Error("expected streak");
        expect(after).toMatchObject({ streak: 1, todayPending: true });
      });

      it("a timezone EAST of UTC (Asia/Tokyo) buckets the SAME instant into the NEXT calendar day -- here, that next day IS today, so todayPending flips to false", async () => {
        // 2026-09-08T16:00:00Z is 2026-09-09 01:00 in Asia/Tokyo (UTC+9) --
        // already tomorrow locally, even though it's still "today" in UTC.
        // "today" (localDateString(NOW, Asia/Tokyo)) is also 2026-09-09, so
        // this instant IS a hit on today, not yesterday.
        readToolMock.mockResolvedValueOnce(outcomeFor([{ ts: "2026-09-08T16:00:00.000Z" }], false));
        const client = makeListWidgetsClient(streakWidget({ display: { dateField: "ts" } }));
        const [rendered] = await renderWidgets(client, "user-1", "home", new Date("2026-09-09T12:00:00.000Z"), "Asia/Tokyo");
        if ("error" in rendered) throw new Error(`unexpected error: ${rendered.error}`);
        if (rendered.kind !== "streak") throw new Error("expected streak");
        expect(rendered).toMatchObject({ streak: 1, todayPending: false });
      });

      it("a date-only value ('2026-09-08', no time component) is used AS-IS regardless of timezone -- never re-parsed through new Date()", async () => {
        readToolMock.mockResolvedValueOnce(outcomeFor([{ ts: "2026-09-08" }], false));
        const client = makeListWidgetsClient(streakWidget({ display: { dateField: "ts" } }));
        const [rendered] = await renderWidgets(client, "user-1", "home", new Date("2026-09-09T12:00:00.000Z"), "Asia/Tokyo");
        if ("error" in rendered) throw new Error(`unexpected error: ${rendered.error}`);
        if (rendered.kind !== "streak") throw new Error("expected streak");
        // "today" in Asia/Tokyo for this NOW is 2026-09-09 (see the test
        // above) -- a date-only "2026-09-08" is yesterday, full stop,
        // regardless of timezone, since it's already a calendar date.
        expect(rendered).toMatchObject({ streak: 1, todayPending: true });
      });
    });
  });
});
